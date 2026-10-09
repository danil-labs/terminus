//! El traspaso desde 0.2.74 antes de tener motor: cerrar su ventana, esperar sus
//! turnos y adoptar. El arranque y la reutilización son de `engine::ensure`.
use super::{engine, legacy, proxy};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Condvar, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use terminus_engine_client::Client;

const BUSY_WITHIN: Duration = Duration::from_secs(120);

#[derive(Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    Pending,
    Active,
    Done,
}

#[derive(Serialize, Clone, PartialEq)]
pub struct Handoff {
    reason: &'static str,
    started: bool,
    window: Step,
    work: Step,
    tasks: Option<u64>,
    git: Step,
    engine: Step,
    done: bool,
}

#[derive(Serialize, Clone, PartialEq)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Phase {
    Ready {
        blank_0274: bool,
    },
    Handoff(Handoff),
    Failed {
        code: String,
        log: PathBuf,
        data: PathBuf,
    },
}

pub struct Launcher {
    paths: Option<engine::Paths>,
    reason: Option<&'static str>,
    phase: Mutex<Phase>,
    consent: (Mutex<bool>, Condvar),
    app: OnceLock<tauri::AppHandle>,
}

impl Launcher {
    /// Una ventana que ya tiene motor; con `paths`, vigila si 0.2.74 quedó abierta en blanco.
    pub fn ready(paths: Option<engine::Paths>) -> Self {
        Self::new(paths, None, Phase::Ready { blank_0274: false })
    }
    pub fn handoff(paths: engine::Paths, reason: &'static str) -> Self {
        let steps = Handoff {
            reason,
            started: false,
            window: Step::Pending,
            work: Step::Pending,
            tasks: None,
            git: Step::Pending,
            engine: Step::Pending,
            done: false,
        };
        Self::new(Some(paths), Some(reason), Phase::Handoff(steps))
    }
    fn new(paths: Option<engine::Paths>, reason: Option<&'static str>, phase: Phase) -> Self {
        Self {
            paths,
            reason,
            phase: Mutex::new(phase),
            consent: (Mutex::new(false), Condvar::new()),
            app: OnceLock::new(),
        }
    }
    pub fn window(&self) -> Option<PathBuf> {
        self.paths.as_ref().map(|paths| paths.window.clone())
    }
    fn set(&self, phase: Phase) {
        let mut current = self.phase.lock().unwrap_or_else(|p| p.into_inner());
        if *current == phase {
            return;
        }
        *current = phase.clone();
        drop(current);
        if let Some(app) = self.app.get() {
            let _ = app.emit("launcher", &phase);
        }
    }
    // Un clic solo vale para la pantalla que lo pide.
    fn ask(&self, phase: Phase) {
        *self.consent.0.lock().unwrap_or_else(|p| p.into_inner()) = false;
        self.set(phase);
    }
    fn phase(&self) -> Phase {
        self.phase.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
    fn consented(&self, within: Duration) -> bool {
        let (flag, signal) = &self.consent;
        let given = flag.lock().unwrap_or_else(|p| p.into_inner());
        let (mut given, _) = signal
            .wait_timeout_while(given, within, |given| !*given)
            .unwrap_or_else(|p| p.into_inner());
        std::mem::take(&mut *given)
    }
    fn wait_consent(&self) {
        while !self.consented(Duration::from_secs(3600)) {}
    }
}

pub fn start(app: tauri::AppHandle, launcher: Arc<Launcher>) {
    let _ = launcher.app.set(app.clone());
    let Some(paths) = launcher.paths.clone() else {
        return;
    };
    let _ = std::thread::Builder::new()
        .name("launcher".into())
        .spawn(move || {
            if let Some(reason) = launcher.reason {
                drive(&app, &launcher, &paths, reason);
            }
            watch(&launcher, &paths);
        });
}

#[tauri::command]
pub(super) fn launcher_state(launcher: tauri::State<'_, Arc<Launcher>>) -> Phase {
    launcher.phase()
}

#[tauri::command]
pub(super) fn launcher_continue(launcher: tauri::State<'_, Arc<Launcher>>) {
    let (flag, signal) = &launcher.consent;
    *flag.lock().unwrap_or_else(|p| p.into_inner()) = true;
    signal.notify_all();
}

/// Por qué una raíz necesita el traspaso antes de arrancar el motor, si lo necesita.
pub fn reason(paths: &engine::Paths) -> Option<&'static str> {
    let root = legacy::classify(&paths.data);
    if root == legacy::Root::Legacy {
        return Some("first");
    }
    if legacy::lanes(&paths.data).is_empty() {
        return None;
    }
    Some(if root == legacy::Root::Adopted {
        "readopt"
    } else {
        "first"
    })
}

fn drive(app: &tauri::AppHandle, launcher: &Launcher, paths: &engine::Paths, reason: &'static str) {
    loop {
        match handoff(launcher, paths, reason) {
            Ok(client) => {
                let state = Arc::new(proxy::State::new(Arc::new(client), true));
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title(&super::title(app, &state.client()));
                }
                app.manage(state);
                if let Phase::Handoff(mut steps) = launcher.phase() {
                    steps.done = true;
                    launcher.ask(Phase::Handoff(steps));
                    launcher.wait_consent();
                }
                launcher.set(Phase::Ready { blank_0274: false });
                return;
            }
            Err(code) => {
                log::error!("[launcher] engine did not start: {code}");
                launcher.ask(Phase::Failed {
                    code,
                    log: paths.launch_log.clone(),
                    data: paths.data.clone(),
                });
                launcher.wait_consent();
            }
        }
    }
}

/// Espera a que 0.2.74 suelte la raíz sin matar nada y arranca el motor con `--adopt-existing`.
fn handoff(
    launcher: &Launcher,
    paths: &engine::Paths,
    reason: &'static str,
) -> Result<Client, String> {
    let mut steps = Handoff {
        reason,
        started: false,
        window: Step::Pending,
        work: Step::Pending,
        tasks: None,
        git: Step::Pending,
        engine: Step::Pending,
        done: false,
    };
    launcher.ask(Phase::Handoff(steps.clone()));
    while !launcher.consented(Duration::from_secs(1)) {
        let lanes = legacy::lanes(&paths.data);
        steps.window = match lanes
            .iter()
            .any(|l| legacy::window_open(l.pid) == Some(true))
        {
            true => Step::Active,
            false if lanes.is_empty() => Step::Done,
            false => Step::Pending,
        };
        steps.work = if lanes.is_empty() {
            Step::Done
        } else {
            Step::Active
        };
        steps.tasks = Some(lanes.iter().filter_map(legacy::busy).sum::<u64>()).filter(|n| *n > 0);
        launcher.set(Phase::Handoff(steps.clone()));
    }
    steps.started = true;
    let mut stopped: Vec<u32> = Vec::new();
    let mut relaunched: Option<Instant> = None;
    let mut busy_since: Option<Instant> = None;
    loop {
        let lanes = legacy::lanes(&paths.data);
        let seen: Vec<Option<bool>> = lanes.iter().map(|l| legacy::window_open(l.pid)).collect();
        // Sin forma de ver la ventana, un servicio que reaparece tras pararlo dice que sigue abierta.
        if seen.contains(&None)
            && !stopped.is_empty()
            && lanes.iter().any(|lane| !stopped.contains(&lane.pid))
        {
            relaunched = Some(Instant::now());
            stopped.clear();
        }
        let window_open = seen.contains(&Some(true))
            || relaunched.is_some_and(|at| at.elapsed() < Duration::from_secs(15));
        steps.window = if window_open {
            Step::Active
        } else {
            Step::Done
        };
        let mut tasks = Vec::new();
        for lane in &lanes {
            let mut count = legacy::busy(lane);
            if !window_open && count.unwrap_or(0) == 0 {
                match legacy::stop(lane) {
                    legacy::Stop::Stopping => stopped.push(lane.pid),
                    legacy::Stop::Busy(n) => count = n,
                }
            }
            tasks.extend(count);
        }
        steps.tasks = Some(tasks.iter().sum::<u64>()).filter(|n| *n > 0);
        steps.work = if lanes.is_empty() {
            Step::Done
        } else {
            Step::Active
        };
        let git = lanes.is_empty() && legacy::git_busy(&paths.data);
        steps.git = match (git, lanes.is_empty()) {
            (true, _) => Step::Active,
            (false, true) => Step::Done,
            (false, false) => Step::Pending,
        };
        log::info!(
            "[launcher] handoff lanes={} window_open={window_open} tasks={:?}",
            lanes.len(),
            steps.tasks
        );
        if !lanes.is_empty() || git {
            launcher.set(Phase::Handoff(steps.clone()));
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }
        steps.engine = Step::Active;
        launcher.set(Phase::Handoff(steps.clone()));
        let adopt = legacy::classify(&paths.data) != legacy::Root::Fresh;
        match engine::ensure(paths, adopt).and_then(|selection| Client::select(&selection)) {
            Ok(client) => {
                steps.engine = Step::Done;
                launcher.set(Phase::Handoff(steps));
                return Ok(client);
            }
            Err(error) if error.code == "service_busy" => {
                if busy_since.get_or_insert_with(Instant::now).elapsed() > BUSY_WITHIN {
                    return Err(error.code);
                }
                steps.engine = Step::Pending;
                std::thread::sleep(Duration::from_secs(1));
            }
            Err(error) => return Err(error.code),
        }
    }
}

/// Con el motor vivo, una 0.2.74 abierta sobre la misma raíz queda en blanco: se avisa aquí.
fn watch(launcher: &Launcher, paths: &engine::Paths) {
    loop {
        if matches!(launcher.phase(), Phase::Ready { .. }) {
            launcher.set(Phase::Ready {
                blank_0274: legacy::blank_window(&paths.data),
            });
        }
        std::thread::sleep(Duration::from_secs(15));
    }
}
