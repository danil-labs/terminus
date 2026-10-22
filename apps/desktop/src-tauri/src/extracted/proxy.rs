//! Proxy cerrado del contrato habitual; cada solicitud captura su workspace.
//! Los canales Tauri quedan en la ventana y el host conserva progreso y ejecución.
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock, RwLock,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use terminus_engine_client::{
    push::{Feed, Start},
    Client,
};
use terminus_engine_protocol::{Error, StreamPage};

use super::fleet::{Engine, Fleet};

/// Su workspace, su corte y, si la tarea vive en otra máquina, el motor de esa máquina.
type OwnedWatch = (Option<String>, Arc<AtomicBool>, Option<Arc<Client>>);
type OpenStream = (String, Option<String>, Option<Arc<Client>>);

/// `--wake <programa>`: el programa enciende la máquina remota y reescribe la
/// selección. Solo lo disparan las acciones de la persona; el sondeo no la enciende.
pub(super) static WAKE: OnceLock<(std::path::PathBuf, std::path::PathBuf)> = OnceLock::new();

/// Una máquina con su motor: la de esta ventana, o un host remoto que
/// `remote-host.py connect` dejó en `<datos>/ai.danil.seldon.remote/<nombre>/`
/// con su selección y su programa `wake`. La activa da los workspaces; las demás
/// corren las tareas que se crearon en ellas (`fleet.rs`).
struct Machine {
    id: String,
    local: bool,
    wake: Option<(std::path::PathBuf, std::path::PathBuf)>,
    /// El motor ya conectado de una máquina que no es la activa.
    parked: Mutex<Option<Arc<Client>>>,
    /// Cuándo no contestó por última vez: no se le vuelve a preguntar enseguida.
    unanswered: Mutex<Option<Instant>>,
    /// La suscripción a sus eventos mientras no es la activa.
    side: Mutex<Option<Feed>>,
    feeding: AtomicBool,
}
impl Machine {
    fn new(
        id: String,
        local: bool,
        wake: Option<(std::path::PathBuf, std::path::PathBuf)>,
    ) -> Self {
        Self {
            id,
            local,
            wake,
            parked: Mutex::new(None),
            unanswered: Mutex::new(None),
            side: Mutex::new(None),
            feeding: AtomicBool::new(false),
        }
    }
}

fn remote_machines() -> Vec<(String, std::path::PathBuf, std::path::PathBuf)> {
    let Some(root) = dirs::data_dir().map(|d| d.join("ai.danil.seldon.remote")) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut found: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let dir = entry.path();
            let (wake, selection) = (dir.join("wake"), dir.join("selection.json"));
            (wake.is_file() && selection.is_file()).then(|| {
                (
                    entry.file_name().to_string_lossy().into_owned(),
                    wake,
                    selection,
                )
            })
        })
        .collect();
    found.sort();
    found
}

fn machines(autostart: bool) -> Vec<Machine> {
    let first = match WAKE.get() {
        Some((program, selection)) => Machine::new(
            selection
                .parent()
                .and_then(|d| d.file_name())
                .map_or("remote".into(), |n| n.to_string_lossy().into_owned()),
            false,
            Some((program.clone(), selection.clone())),
        ),
        None => Machine::new("local".into(), autostart, None),
    };
    let mut all = vec![first];
    for (id, program, selection) in remote_machines() {
        if all.iter().all(|m| m.id != id) {
            all.push(Machine::new(id, false, Some((program, selection))));
        }
    }
    all
}
/// La máquina de la ventana, la primera: da los workspaces y nunca cambia.
const HOME: usize = 0;
const WAKES: &[&str] = &[
    "send_message",
    // La tarea vacía de la vista previa nace donde nacería la del primer mensaje.
    "create_empty_session",
    "inject_message",
    "create_project",
    "create_agent",
    "respond_permission",
    "answer_question",
    "answer_shell_output",
    "run_shell_command",
    "queue_ready",
    "resume_awaiting_quota",
    "recreate_task_work",
    // Llevar trabajo despierta la máquina de destino con `work_import {probe: true}`.
    "work_import",
];
/// La suscripción viva y el cursor que la ventana ya recibió de ella.
struct Fed {
    client: Arc<Client>,
    feed: Feed,
    delivered: Option<u64>,
}
// Cuánto espera `service_poll` lo empujado antes de contestar sin eventos.
const PUSH_WAIT: Duration = Duration::from_secs(20);
// Una máquina que no contestó no se vuelve a probar al listar hasta pasado esto.
const UNANSWERED_WAIT: Duration = Duration::from_secs(15);
const HISTORY_TURNS: u64 = 150;

pub(super) struct State {
    client: RwLock<Arc<Client>>,
    autostart: bool,
    restarts: Mutex<Vec<Instant>>,
    restart_failure: Mutex<Option<Error>>,
    waking: Mutex<()>,
    woke: AtomicBool,
    machines: Vec<Machine>,
    workspace: Mutex<Option<String>>,
    closed: AtomicBool,
    in_flight: AtomicUsize,
    stream_gap: AtomicBool,
    watchers: Mutex<std::collections::BTreeMap<String, OwnedWatch>>,
    clones: Mutex<std::collections::BTreeMap<String, Option<String>>>,
    streams: Mutex<Vec<OpenStream>>,
    feed: Mutex<Option<Fed>>,
    sessions: Mutex<Option<Vec<String>>>,
    fleet: Fleet,
}
impl State {
    pub fn new(client: Arc<Client>, autostart: bool) -> Self {
        let fleet = Fleet::load(Some(&client.selection().window_data));
        Self {
            client: RwLock::new(client),
            autostart,
            restarts: Mutex::new(Vec::new()),
            restart_failure: Mutex::new(None),
            waking: Mutex::new(()),
            woke: AtomicBool::new(false),
            machines: machines(autostart),
            workspace: Mutex::new(None),
            closed: AtomicBool::new(false),
            in_flight: AtomicUsize::new(0),
            stream_gap: AtomicBool::new(false),
            watchers: Mutex::new(Default::default()),
            clones: Mutex::new(Default::default()),
            streams: Mutex::new(Vec::new()),
            feed: Mutex::new(None),
            sessions: Mutex::new(None),
            fleet,
        }
    }
    pub fn client(&self) -> Arc<Client> {
        self.client
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
    /// Relanza el motor empaquetado tras un corte, o adopta el que otra ventana relanzó;
    /// como mucho tres veces en diez minutos.
    fn restart(&self) -> Result<(), Error> {
        if !self.autostart || !self.machine().local {
            return Err(Error::new("app_unavailable"));
        }
        let mut restarts = self.restarts.lock().unwrap_or_else(|p| p.into_inner());
        restarts.retain(|at| at.elapsed() < Duration::from_secs(600));
        let mut last_failure = self
            .restart_failure
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if restarts.len() >= 3 {
            return Err(last_failure
                .clone()
                .unwrap_or_else(|| Error::new("app_unavailable")));
        }
        restarts.push(Instant::now());
        let selected = super::engine::paths()
            .and_then(|paths| super::engine::ensure(&paths, false))
            .and_then(|selection| Client::select(&selection));
        match selected {
            Ok(client) => {
                *last_failure = None;
                *self.client.write().unwrap_or_else(|p| p.into_inner()) = Arc::new(client);
                Ok(())
            }
            Err(error) => {
                *last_failure = Some(error.clone());
                Err(error)
            }
        }
    }
    fn machine(&self) -> &Machine {
        &self.machines[HOME]
    }
    /// La máquina activa es remota: apagada se enciende al actuar, no al sondear.
    fn remote(&self) -> bool {
        self.machine().wake.is_some()
    }
    /// Enciende la máquina activa con su programa y adopta el motor que publica.
    fn wake(&self) -> Result<(), Error> {
        let Some((program, selection)) = self.machine().wake.clone() else {
            return Err(Error::new("app_unavailable"));
        };
        let _turn = self.waking.lock().unwrap_or_else(|p| p.into_inner());
        // Otra acción pudo encenderla mientras esta esperaba su turno.
        if self
            .client()
            .request("status", None, json!({}), Duration::from_secs(3))
            .is_ok()
        {
            return Ok(());
        }
        let client = woken(&program, &selection)?;
        *self.client.write().unwrap_or_else(|p| p.into_inner()) = client;
        self.woke.store(true, Ordering::SeqCst);
        Ok(())
    }
    fn index(&self, id: &str) -> Option<usize> {
        self.machines.iter().position(|m| m.id == id)
    }
    /// Otra máquina distinta de la activa, si la orden es suya (`fleet.rs`).
    fn elsewhere(&self, id: Option<String>) -> Option<usize> {
        let active = HOME;
        id.and_then(|id| self.index(&id)).filter(|&i| i != active)
    }
    /// El motor de una máquina sin encenderla: el activo, el aparcado o el que publica
    /// su selección. Una que no contestó no se vuelve a probar enseguida.
    fn reach(&self, i: usize) -> Option<Arc<Client>> {
        if i == HOME {
            return Some(self.client());
        }
        let machine = &self.machines[i];
        let mut parked = machine.parked.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(client) = parked.as_ref().filter(|c| c.check_selection().is_ok()) {
            return Some(client.clone());
        }
        let mut unanswered = machine.unanswered.lock().unwrap_or_else(|p| p.into_inner());
        if unanswered.is_some_and(|at| at.elapsed() < UNANSWERED_WAIT) {
            return None;
        }
        let selected = match &machine.wake {
            Some((_, selection)) => Client::select(selection),
            None => super::engine::paths()
                .and_then(|paths| super::engine::ensure(&paths, false))
                .and_then(|selection| Client::select(&selection)),
        };
        match selected {
            Ok(client) => {
                let client = Arc::new(client);
                *parked = Some(client.clone());
                *unanswered = None;
                Some(client)
            }
            Err(_) => {
                *unanswered = Some(Instant::now());
                None
            }
        }
    }
    /// Enciende una máquina con su programa y adopta el motor que publica. Otra acción
    /// pudo encenderla mientras esta esperaba su turno: entonces vale la suya.
    fn wake_now(&self, i: usize) -> Result<Arc<Client>, Error> {
        let machine = &self.machines[i];
        let Some((program, selection)) = &machine.wake else {
            return Err(Error::new("app_unavailable"));
        };
        let _turn = self.waking.lock().unwrap_or_else(|p| p.into_inner());
        *machine.unanswered.lock().unwrap_or_else(|p| p.into_inner()) = None;
        if let Some(client) = self.reach(i).filter(|c| answers(c)) {
            return Ok(client);
        }
        let client = woken(program, selection)?;
        *machine.parked.lock().unwrap_or_else(|p| p.into_inner()) = Some(client.clone());
        Ok(client)
    }
    /// Las demás máquinas con su motor si contesta sin encenderla.
    fn others(&self) -> Vec<(String, Option<Arc<Client>>)> {
        let active = HOME;
        (0..self.machines.len())
            .filter(|&i| i != active)
            .map(|i| (self.machines[i].id.clone(), self.reach(i)))
            .collect()
    }
    fn stop_feed(&self) {
        if let Some(fed) = self.feed.lock().unwrap_or_else(|p| p.into_inner()).take() {
            fed.feed.stop();
        }
    }
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.stop_feed();
        let streams = std::mem::take(&mut *self.streams.lock().unwrap_or_else(|p| p.into_inner()));
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let watchers =
            std::mem::take(&mut *self.watchers.lock().unwrap_or_else(|p| p.into_inner()));
        for machine in &self.machines {
            if let Some(feed) = machine
                .side
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .take()
            {
                feed.stop();
            }
        }
        for (id, (workspace, cancel, there)) in watchers {
            cancel.store(true, Ordering::SeqCst);
            if std::time::Instant::now() >= deadline {
                break;
            }
            let _ = there.unwrap_or_else(|| self.client()).request(
                "service invoke",
                workspace,
                json!({"command":"unwatch_task_tree","arguments":{"id":id}}),
                Duration::from_millis(300),
            );
        }
        for (id, workspace, there) in streams {
            if std::time::Instant::now() >= deadline {
                break;
            }
            let _ = there.unwrap_or_else(|| self.client()).request(
                "service stream cancel",
                workspace,
                json!({"stream_id":id}),
                Duration::from_millis(300),
            );
        }
    }
    fn workspace(&self) -> Option<String> {
        self.workspace
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
}
fn manifest() -> &'static Value {
    static M: OnceLock<Value> = OnceLock::new();
    M.get_or_init(|| {
        serde_json::from_str(terminus_engine_protocol::MANIFEST).expect("frozen command manifest")
    })
}
fn command(name: &str) -> Option<&'static Value> {
    manifest()["commands"]
        .as_array()?
        .iter()
        .find(|c| c["name"] == name)
}
fn answers(client: &Client) -> bool {
    client
        .request("status", None, json!({}), Duration::from_secs(2))
        .is_ok()
}

/// Corre el programa de encendido, que reabre el túnel y reescribe la selección.
fn woken(program: &std::path::Path, selection: &std::path::Path) -> Result<Arc<Client>, Error> {
    // Medido: de VM apagada a motor listo, unos 20 s; EC2 puede tardar minutos.
    let status = crate::util::output_with_timeout(
        crate::util::no_console_window(&mut std::process::Command::new(program)).arg(selection),
        Duration::from_secs(300),
    )?;
    if !status.success() {
        return Err(Error::new("app_unavailable"));
    }
    Ok(Arc::new(Client::select(selection)?))
}

pub(super) fn desktop_command(name: &str) -> bool {
    command(name).is_some_and(|c| c["kind"] == "desktop")
        || matches!(
            name,
            "launcher_state"
                | "launcher_continue"
                | "window_painted"
                | "window_background"
                | "update_install"
                | "update_pending"
                | "close_confirmed"
                | "window_to_background"
                | "tray_update"
                | "quit_completely"
                | "restart_app"
                | "tray_notify"
                | "machine_list"
                | "account_relay_token"
                | "service_filter"
                | "load_history"
        )
}
pub(super) fn with_desktop(
    local: impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    move |invoke| {
        if desktop_command(invoke.message.command()) {
            local(invoke)
        } else {
            handle(invoke);
            true
        }
    }
}
fn failure(error: &Error) -> Value {
    if error.code == "operation_failed"
        && (error.detail.is_string() || error.detail.get("what").is_some())
    {
        return error.detail.clone();
    }
    // Un motor que no escucha no vuelve solo: `engine_down` no está en los reintentos de `src/lib/invoke.ts`.
    if error.code == "app_unavailable" {
        return json!({"what":{"clave":"shell.service.engine_down"},"detail":"engine_down"});
    }
    if error.code == "engine_missing" {
        return json!({"what":{"clave":"shell.service.engine_missing"},"detail":error.detail});
    }
    let key = match error.code.as_str() {
        "service_busy" | "task_busy" => "shell.service.busy",
        "invalid_token" | "io" => "shell.service.unreachable",
        "version_mismatch" | "service_version" => "shell.service.version",
        "no_host" => "shell.service.no_host",
        "command" | "unsupported" => "shell.service.command",
        _ => "shell.service.failed",
    };
    json!({"what":{"clave":key},"detail":error.code})
}
fn reply(value: Value) -> Result<Value, Value> {
    if let Some(error) = value.get("error") {
        Err(error.clone())
    } else if let Some(value) = value.get("value") {
        Ok(value.clone())
    } else {
        Err(failure(&Error::new("invalid_request")))
    }
}
pub(super) fn invoke(state: &State, command: &str, arguments: Value) -> Result<Value, Value> {
    state
        .client()
        .invoke(command, state.workspace(), arguments)
        .map_err(|e| failure(&e))
        .and_then(reply)
}
type Job = Box<dyn FnOnce() + Send>;
fn ordered(job: Job) -> std::io::Result<()> {
    static Q: OnceLock<std::sync::mpsc::Sender<Job>> = OnceLock::new();
    let sender = Q.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel::<Job>();
        std::thread::spawn(move || {
            for job in rx {
                job();
            }
        });
        tx
    });
    sender
        .send(job)
        .map_err(|_| std::io::Error::other("workspace queue"))
}
struct Slot(Arc<State>);
impl Drop for Slot {
    fn drop(&mut self) {
        self.0.in_flight.fetch_sub(1, Ordering::SeqCst);
    }
}

pub(super) fn handle(invoke: tauri::ipc::Invoke) {
    let name = invoke.message.command().to_owned();
    let Some(spec) = command(&name).filter(|c| c["kind"] != "desktop") else {
        invoke.resolver.reject(failure(&Error::new("command")));
        return;
    };
    let tauri::ipc::InvokeBody::Json(mut args) = invoke.message.payload().clone() else {
        invoke
            .resolver
            .reject(failure(&Error::new("invalid_request")));
        return;
    };
    let webview = invoke.message.webview().clone();
    let Some(state) = webview.app_handle().try_state::<Arc<State>>() else {
        invoke
            .resolver
            .reject(failure(&Error::new("app_unavailable")));
        return;
    };
    let state = state.inner().clone();
    if state.closed.load(Ordering::SeqCst) {
        invoke
            .resolver
            .reject(failure(&Error::new("app_unavailable")));
        return;
    }
    if state.in_flight.fetch_add(1, Ordering::SeqCst) >= 256 {
        state.in_flight.fetch_sub(1, Ordering::SeqCst);
        invoke.resolver.reject(failure(&Error::new("service_busy")));
        return;
    }
    let slot = Slot(state.clone());
    let workspace = if name == "tree_show" && args["tree"] == "terminus-chat-visuals" {
        // El scope pertenece al sobre RPC1, no a los parámetros congelados del comando.
        let Some(workspace) = invoke
            .message
            .headers()
            .get("x-terminus-workspace")
            .and_then(|value| value.to_str().ok())
            .filter(|value| !value.is_empty())
        else {
            invoke
                .resolver
                .reject(failure(&Error::new("invalid_request")));
            return;
        };
        Some(workspace.to_owned())
    } else if matches!(
        name.as_str(),
        "stop_turn" | "stop_shell_command" | "write_shell_input" | "pending_requests"
    ) {
        // Cerrar con tareas vivas detiene también las de otros workspaces.
        invoke
            .message
            .headers()
            .get("x-terminus-workspace")
            .and_then(|value| value.to_str().ok())
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .or_else(|| state.workspace())
    } else if name == "unwatch_task_tree" {
        let watchers = state.watchers.lock().unwrap_or_else(|p| p.into_inner());
        args["id"]
            .as_str()
            .and_then(|id| watchers.get(id))
            .map(|(scope, _, _)| scope.clone())
            .unwrap_or_else(|| state.workspace())
    } else if name == "cancel_project_clone" {
        args["operation"]
            .as_str()
            .and_then(|id| {
                state
                    .clones
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .get(id)
                    .cloned()
            })
            .unwrap_or_else(|| state.workspace())
    } else {
        state.workspace()
    };
    // Lo que nombra una tarea de otra máquina va a esa máquina; crear, a la elegida.
    let chosen = invoke
        .message
        .headers()
        .get("x-terminus-machine")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let elsewhere = if state.machines.len() > 1 && name != "unwatch_task_tree" {
        state.elsewhere(
            state
                .fleet
                .target(spec, &args, workspace.as_deref(), chosen.as_deref()),
        )
    } else {
        None
    };
    // El corte de un árbol que se vigila en otra máquina va al motor que lo vigila.
    let watched_there = if name == "unwatch_task_tree" {
        args["id"].as_str().and_then(|id| {
            state
                .watchers
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .get(id)
                .and_then(|(_, _, there)| there.clone())
        })
    } else {
        None
    };
    let app = webview.app_handle().clone();
    let channel = if let Some(key) = spec["channel"].as_str() {
        let id = match args
            .get(key)
            .cloned()
            .and_then(|v| serde_json::from_value::<tauri::ipc::JavaScriptChannelId>(v).ok())
        {
            Some(id) => id,
            None => {
                invoke
                    .resolver
                    .reject(failure(&Error::new("invalid_request")));
                return;
            }
        };
        if let Some(args) = args.as_object_mut() {
            args.remove(key);
        }
        Some((key.to_owned(), id.channel_on::<_, Value>(webview)))
    } else {
        None
    };
    let resolver = Arc::new(Mutex::new(Some(invoke.resolver)));
    let worker = resolver.clone();
    let queued = name == "set_active_workspace";
    // Se adopta al clic: adoptado al contestar el motor, lo pedido entretanto
    // sale con el workspace anterior y el motor lo devuelve como activo.
    let adopted = if queued {
        args["id"].as_str().map(str::to_owned)
    } else {
        None
    };
    if let Some(id) = &adopted {
        *state.workspace.lock().unwrap_or_else(|p| p.into_inner()) = Some(id.clone());
    }
    let job = move || {
        let _slot = slot;
        if let Some(i) = elsewhere {
            let routed = routed(&state, i, spec, &args, workspace.as_deref());
            match (routed, channel) {
                (Err(error), _) => resolve(&worker, Err(error)),
                (Ok(Routed::Stream(there, remote, args)), Some((key, channel))) => {
                    let to = (Some(remote), Some(there));
                    stream(state.clone(), &name, args, to, key, channel, worker);
                }
                (Ok(Routed::Stream(..)), None) => {
                    resolve(&worker, Err(failure(&Error::new("invalid_request"))))
                }
                (Ok(Routed::Done(result)), _) => resolve(&worker, result),
            }
            if WAKES.contains(&name.as_str()) {
                side_feeds(&app, &state);
            }
            return;
        }
        if let Some((key, channel)) = channel {
            stream(state, &name, args, (workspace, None), key, channel, worker);
            return;
        }
        let via = watched_there.unwrap_or_else(|| state.client());
        let mut sent = via.invoke(&name, workspace.clone(), args.clone());
        // `app_unavailable` es no haber conectado: reintentar no duplica la acción.
        if matches!(&sent, Err(e) if e.code == "app_unavailable")
            && WAKES.contains(&name.as_str())
            && state.wake().is_ok()
        {
            sent = state
                .client()
                .invoke(&name, workspace.clone(), args.clone());
        }
        let mut result = sent.map_err(|e| failure(&e)).and_then(reply);
        if let (Ok(mine), Some(local)) = (&mut result, &workspace) {
            if state.machines.len() > 1 {
                gathered(&state, &name, local, &args, mine);
            }
        }
        if name == "check_environment" {
            if let Ok(value) = &mut result {
                value["engineBuild"] = json!(super::startup::engine_build(state.client().status()));
            }
        }
        if let Ok(value) = &result {
            if name == "unwatch_task_tree" {
                if let Some((_, cancel, _)) = args["id"].as_str().and_then(|id| {
                    state
                        .watchers
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .remove(id)
                }) {
                    cancel.store(true, Ordering::SeqCst);
                }
            }

            let target = match name.as_str() {
                "workspaces_startup" if state.workspace().is_none() => value["active"].as_str(),
                _ => None,
            };
            if let Some(target) = target {
                *state.workspace.lock().unwrap_or_else(|p| p.into_inner()) =
                    Some(target.to_owned());
            }
            if name == "remove_workspace" && workspace.as_deref() == args["id"].as_str() {
                *state.workspace.lock().unwrap_or_else(|p| p.into_inner()) = None;
            }
        }
        if let (Err(_), Some(id)) = (&result, &adopted) {
            let mut current = state.workspace.lock().unwrap_or_else(|p| p.into_inner());
            if current.as_deref() == Some(id.as_str()) {
                *current = workspace.clone();
            }
        }
        resolve(&worker, result);
    };
    let spawned = if queued {
        ordered(Box::new(job))
    } else {
        std::thread::Builder::new().spawn(job).map(|_| ())
    };
    if spawned.is_err() {
        resolve(&resolver, Err(failure(&Error::new("service_busy"))));
    }
}
enum Routed {
    Done(Result<Value, Value>),
    /// Una orden con canal: el stream se abre contra ese motor, con sus ids.
    Stream(Arc<Client>, String, Value),
}
fn machine_off() -> Value {
    json!({"what":{"clave":"shell.service.machine_off"},"detail":"machine_off"})
}
fn wake_failed() -> Value {
    let clave = super::util::Frase::new("shell.service.machine_wake_failed").0;
    json!({"what":{"clave":clave},"detail":"machine_wake_failed"})
}
fn unlinked() -> Value {
    json!({"what":{"clave":"shell.machines.unlinked"},"detail":"machine_unlinked"})
}
/// Una orden de una tarea de otra máquina. Solo una acción de la persona la enciende.
fn routed(
    state: &State,
    i: usize,
    spec: &Value,
    args: &Value,
    workspace: Option<&str>,
) -> Result<Routed, Value> {
    let name = spec["name"].as_str().unwrap_or_default();
    let local = workspace.ok_or_else(|| failure(&Error::new("invalid_request")))?;
    let home = state.client();
    let id = &state.machines[i].id;
    if WAKES.contains(&name) {
        *state.machines[i]
            .unanswered
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = None;
        let sent = state
            .fleet
            .deliver(id, local, spec, args, &*home, state.reach(i), || {
                state.wake_now(i)
            })
            // Solo `wake` falla aquí: su programa no la encendió.
            .map_err(|_| wake_failed())?
            .ok_or_else(unlinked)?;
        return Ok(Routed::Done(sent.map_err(|e| failure(&e)).and_then(reply)));
    }
    let Some(there) = state.reach(i) else {
        // Abrir una tarea de una máquina apagada no es un fallo: se enseña lo último leído.
        return match (name, args["id"].as_str()) {
            ("load_session", Some(session)) => Ok(Routed::Done(Ok(state
                .fleet
                .offline_task(id, local, session)))),
            _ => Err(machine_off()),
        };
    };
    if spec["channel"].is_string() {
        let (remote, args) = state
            .fleet
            .translate(id, local, args, &*home, &*there)
            .ok_or_else(unlinked)?;
        return Ok(Routed::Stream(there, remote, args));
    }
    let sent = state
        .fleet
        .forward(id, local, spec, args, &*home, &*there)
        .ok_or_else(unlinked)?;
    if let (Ok(task), "load_session", Some(session)) = (&sent, name, args["id"].as_str()) {
        if let Some(task) = task.get("value") {
            state.fleet.remember_task(id, session, task);
        }
    }
    Ok(Routed::Done(sent.map_err(|e| failure(&e)).and_then(reply)))
}
/// Lo que la ventana lista de este workspace incluye lo de las demás máquinas.
fn gathered(state: &State, name: &str, local: &str, args: &Value, mine: &mut Value) {
    if !matches!(
        name,
        "list_live_sessions" | "list_active_turns" | "list_live_turns"
    ) {
        return;
    }
    let others = state.others();
    let engines: Vec<(String, Option<&dyn Engine>)> = others
        .iter()
        .map(|(id, client)| (id.clone(), client.as_deref().map(|c| c as &dyn Engine)))
        .collect();
    let home = state.client();
    *mine = if name == "list_live_sessions" {
        state.fleet.list(local, args, mine.take(), &*home, &engines)
    } else {
        state
            .fleet
            .turns(name, local, args, mine.take(), &*home, &engines)
    };
}
/// Los eventos de las tareas de las demás máquinas llegan a los mismos oyentes, con
/// los ids de la ventana: una suscripción por máquina que tenga este workspace.
fn side_feeds(app: &tauri::AppHandle, state: &Arc<State>) {
    let Some(local) = state.workspace() else {
        return;
    };
    let active = HOME;
    for (i, machine) in state.machines.iter().enumerate() {
        if i == active
            || !state.fleet.linked(&machine.id, &local)
            || machine.feeding.swap(true, Ordering::SeqCst)
        {
            continue;
        }
        let (app, owned) = (app.clone(), state.clone());
        let spawned = std::thread::Builder::new()
            .name("machine-feed".into())
            .spawn(move || {
                side_feed(&app, &owned, i);
                owned.machines[i].feeding.store(false, Ordering::SeqCst);
            });
        if spawned.is_err() {
            machine.feeding.store(false, Ordering::SeqCst);
        }
    }
}
fn side_feed(app: &tauri::AppHandle, state: &State, i: usize) {
    let Some(client) = state.reach(i) else {
        return;
    };
    let machine = &state.machines[i];
    let done = || state.closed.load(Ordering::SeqCst);
    let emit = |events: &Value| {
        for event in events.as_array().into_iter().flatten() {
            let Some(name) = event["name"].as_str() else {
                continue;
            };
            if let Some(payload) = state.fleet.localize(&machine.id, name, &event["payload"]) {
                let _ = app.emit(name, payload);
            }
        }
    };
    if client.push_stream() {
        let sessions = state
            .sessions
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        let start = Start {
            cursor: None,
            replay: false,
            runtime: None,
            sessions,
        };
        let feed = Feed::start(client, start);
        *machine.side.lock().unwrap_or_else(|p| p.into_inner()) = Some(feed.clone());
        while !done() {
            let page = feed.next(PUSH_WAIT);
            if page.failure.is_some() {
                break;
            }
            // Un reenvío (`catchup`) reemplaza el turno en curso; aquí solo se suma lo nuevo.
            for batch in page.batches.iter().filter(|b| b.get("catchup").is_none()) {
                emit(&batch["events"]);
            }
        }
        feed.stop();
        *machine.side.lock().unwrap_or_else(|p| p.into_inner()) = None;
        return;
    }
    let mut cursor: Option<u64> = None;
    while !done() {
        let Ok(page) = client.request(
            "service events",
            None,
            json!({"cursor":cursor,"replay":false,"desktop":true,"desktop_pid":std::process::id()}),
            Duration::from_secs(3),
        ) else {
            return;
        };
        if cursor.is_some() {
            emit(&page["events"]);
        }
        cursor = page["cursor"].as_u64();
        std::thread::sleep(Duration::from_millis(500));
    }
}
fn resolve(
    resolver: &Arc<Mutex<Option<tauri::ipc::InvokeResolver>>>,
    result: Result<Value, Value>,
) {
    if let Some(resolver) = resolver.lock().unwrap_or_else(|p| p.into_inner()).take() {
        match result {
            Ok(value) => resolver.resolve(value),
            Err(error) => resolver.reject(error),
        }
    }
}
/// El workspace del sobre y, si la tarea vive en otra máquina, su motor.
fn stream(
    state: Arc<State>,
    name: &str,
    arguments: Value,
    (workspace, there): (Option<String>, Option<Arc<Client>>),
    key: String,
    channel: tauri::ipc::Channel<Value>,
    resolver: Arc<Mutex<Option<tauri::ipc::InvokeResolver>>>,
) {
    let client = there.clone().unwrap_or_else(|| state.client());
    let clone_operation = if name == "clone_project" {
        arguments["operation"].as_str().map(str::to_owned)
    } else {
        None
    };
    if let Some(operation) = &clone_operation {
        state
            .clones
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(operation.clone(), workspace.clone());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let start = client.request(
        "service stream start",
        workspace.clone(),
        json!({"command":name,"arguments":arguments,"stream_id":id,"channel":key}),
        Duration::from_secs(30),
    );
    if !start.as_ref().is_ok_and(|value| value["stream_id"] == id) {
        if let Some(operation) = &clone_operation {
            state
                .clones
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(operation);
        }
    }
    match start {
        Ok(value) if value["stream_id"] == id => {}
        Ok(_) => {
            resolve(&resolver, Err(failure(&Error::new("invalid_request"))));
            return;
        }
        Err(e) => {
            resolve(&resolver, Err(failure(&e)));
            return;
        }
    }
    state
        .streams
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .push((id.clone(), workspace.clone(), there.clone()));
    let cancel = Arc::new(AtomicBool::new(false));
    let mut cursor = None;
    let result = (|| -> Result<(), Value> {
        while !state.closed.load(Ordering::SeqCst) && !cancel.load(Ordering::SeqCst) {
            let value = client
                .request(
                    "service stream read",
                    workspace.clone(),
                    json!({"stream_id":id,"cursor":cursor}),
                    Duration::from_secs(10),
                )
                .map_err(|e| failure(&e))?;
            let page: StreamPage = serde_json::from_value(value)
                .map_err(|_| failure(&Error::new("invalid_request")))?;
            if page.stream_id != id || page.gap || cursor.is_some_and(|c| page.cursor < c) {
                return Err(failure(&Error::new("io")));
            }
            let mut latest = cursor.unwrap_or(0);
            for event in page.events {
                if event.seq <= latest || event.seq > page.cursor {
                    return Err(failure(&Error::new("invalid_request")));
                }
                channel
                    .send(event.payload)
                    .map_err(|_| failure(&Error::new("io")))?;
                latest = event.seq;
            }
            cursor = Some(page.cursor);
            if let Some(completion) = page.completion {
                if name == "watch_task_tree" {
                    if let Some(watcher) = completion["value"].as_str() {
                        state
                            .watchers
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .entry(watcher.to_owned())
                            .or_insert_with(|| (workspace.clone(), cancel.clone(), there.clone()));
                    }
                }
                resolve(&resolver, reply(completion));
            }
            if page.done {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        if cancel.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err(failure(&Error::new("app_unavailable")))
        }
    })();
    if let Err(error) = result {
        state.stream_gap.store(true, Ordering::SeqCst);
        resolve(&resolver, Err(error.clone()));
        log::warn!("[transport] stream={name} code={}", error["detail"]);
    }
    let _ = client.request(
        "service stream cancel",
        workspace,
        json!({"stream_id":id}),
        Duration::from_secs(2),
    );
    if let Some(operation) = &clone_operation {
        state
            .clones
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(operation);
    }
    state
        .watchers
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .retain(|_, (_, value, _)| !Arc::ptr_eq(value, &cancel));
    state
        .streams
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .retain(|(key, _, _)| key != &id);
}

#[tauri::command(async)]
pub(super) fn service_poll(
    app: tauri::AppHandle,
    cursor: Option<u64>,
    workspace: Option<String>,
    replay: bool,
    runtime: Option<String>,
    setup: Option<bool>,
) -> Result<Value, Value> {
    let state = app
        .try_state::<Arc<State>>()
        .ok_or_else(|| failure(&Error::new("app_unavailable")))?;
    if state.machines.len() > 1 {
        side_feeds(&app, state.inner());
    }
    if state.woke.swap(false, Ordering::SeqCst) {
        if let Some(window) = app.get_window("main") {
            let _ = window.set_title(&super::title(&app));
        }
        return Ok(
            json!({"cursor":null,"gap":false,"replay":true,"runtime":state.client().runtime(),"reset":true}),
        );
    }
    if runtime
        .as_ref()
        .is_some_and(|id| id != state.client().runtime())
    {
        return Err(failure(&Error::new("version_mismatch")));
    }
    let client = state.client();
    // Configuración sondea a la vez que la app: con su propio cursor, por el camino de siempre.
    if client.push_stream() && setup != Some(true) {
        return pushed(&app, &state, client, cursor, replay, runtime);
    }
    let polled = client.request(
        "service events",
        workspace.clone(),
        json!({"cursor":cursor,"workspace":workspace,"replay":replay,"desktop":true,"desktop_pid":std::process::id(),"tail":setup==Some(true)&&cursor.is_none()}),
        Duration::from_secs(3),
    );
    let page = match polled {
        // Otra ventana pudo relanzarlo ya: su selección nueva invalida este cliente antes de conectar.
        Err(error)
            if error.code == "app_unavailable" || state.client().check_selection().is_err() =>
        {
            return restarted(&app, &state, error);
        }
        other => other.map_err(|e| failure(&e))?,
    };
    if let Some(events) = page["events"].as_array() {
        for event in events {
            let Some(name) = event["name"].as_str() else {
                return Err(failure(&Error::new("invalid_request")));
            };
            if !known_event(name) {
                return Err(failure(&Error::new("invalid_request")));
            }
            // El alta (Setup) conecta cuentas e integraciones: necesita `account`, `install`, `mcp`…
            // App no está montada mientras sondea, así que nada llega dos veces.
            let _ = app.emit(name, &event["payload"]);
        }
    }
    // Un stream de comando cortado no pierde eventos del diario: va aparte de `gap`.
    Ok(
        json!({"cursor":page["cursor"],"gap":page["gap"] == true,"streams":state.stream_gap.swap(false, Ordering::SeqCst),"replay":page["replay"],"runtime":state.client().runtime(),"reset":false}),
    )
}
fn known_event(name: &str) -> bool {
    manifest()["events"]
        .as_array()
        .is_some_and(|names| names.iter().any(|v| v == name))
}
fn restarted(app: &tauri::AppHandle, state: &State, error: Error) -> Result<Value, Value> {
    if state.remote() {
        return Err(machine_off());
    }
    // Sin motor que relanzar (un antivirus puede apartarlo), el aviso dice eso y no «no responde».
    if let Err(restart) = state.restart() {
        let shown = if restart.code == "engine_missing" {
            restart
        } else {
            error
        };
        return Err(failure(&shown));
    }
    if let Some(window) = app.get_window("main") {
        let _ = window.set_title(&super::title(app));
    }
    Ok(
        json!({"cursor":null,"gap":false,"replay":true,"runtime":state.client().runtime(),"reset":true}),
    )
}
/// Lo empujado desde la última llamada, en lotes que la ventana reparte a sus
/// oyentes. La suscripción sigue al cursor que manda la ventana: otro, una recarga.
fn pushed(
    app: &tauri::AppHandle,
    state: &State,
    client: Arc<Client>,
    cursor: Option<u64>,
    replay: bool,
    runtime: Option<String>,
) -> Result<Value, Value> {
    let feed = {
        let mut fed = state.feed.lock().unwrap_or_else(|p| p.into_inner());
        let current = fed
            .as_ref()
            .filter(|fed| Arc::ptr_eq(&fed.client, &client) && fed.delivered == cursor)
            .map(|fed| fed.feed.clone());
        match current {
            Some(feed) => feed,
            None => {
                if let Some(old) = fed.take() {
                    old.feed.stop();
                }
                let sessions = state
                    .sessions
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .clone();
                let feed = Feed::start(
                    client.clone(),
                    Start {
                        cursor,
                        replay,
                        runtime,
                        sessions,
                    },
                );
                *fed = Some(Fed {
                    client: client.clone(),
                    feed: feed.clone(),
                    delivered: cursor,
                });
                feed
            }
        }
    };
    let page = feed.next(PUSH_WAIT);
    if let Some(error) = page.failure {
        if error.code == "app_unavailable" || client.check_selection().is_err() {
            state.stop_feed();
            return restarted(app, state, error);
        }
        return Err(failure(&error));
    }
    if let Some(fed) = state
        .feed
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_mut()
        .filter(|fed| Arc::ptr_eq(&fed.client, &client))
    {
        fed.delivered = page.cursor;
    }
    let mut batches = page.batches;
    for batch in &mut batches {
        if let Some(events) = batch["events"].as_array_mut() {
            events.retain(|event| event["name"].as_str().is_some_and(known_event));
        }
    }
    Ok(
        json!({"cursor":page.cursor,"gap":page.gap,"streams":state.stream_gap.swap(false, Ordering::SeqCst),"replay":false,"runtime":client.runtime(),"reset":false,"push":true,"batches":batches}),
    )
}
/// Las tareas cuyo flujo token a token quiere la ventana: las visibles y las que corren.
#[tauri::command]
pub(super) fn service_filter(
    app: tauri::AppHandle,
    sessions: Option<Vec<String>>,
) -> Result<(), Value> {
    let state = app
        .try_state::<Arc<State>>()
        .ok_or_else(|| failure(&Error::new("app_unavailable")))?;
    *state.sessions.lock().unwrap_or_else(|p| p.into_inner()) = sessions.clone();
    for machine in &state.machines {
        if let Some(feed) = machine
            .side
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
        {
            feed.filter(sessions.clone());
        }
    }
    if let Some(fed) = state
        .feed
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
    {
        fed.feed.filter(sessions);
    }
    Ok(())
}
/// Una tarea con sus últimos turnos (`service history`) y su lugar en la
/// transcripción entera. Un motor sin el stream empujado la manda entera.
#[tauri::command(async)]
pub(super) fn load_history(
    app: tauri::AppHandle,
    project: String,
    id: String,
    before: Option<u64>,
) -> Result<Value, Value> {
    let state = app
        .try_state::<Arc<State>>()
        .ok_or_else(|| failure(&Error::new("app_unavailable")))?;
    let client = state.client();
    let workspace = state.workspace();
    // Una tarea de otra máquina se lee de su motor, sin encenderla; apagada, se enseña
    // lo último que se leyó de ella.
    if let Some(i) = state.elsewhere(state.fleet.owner(workspace.as_deref(), &id)) {
        let machine = state.machines[i].id.clone();
        let local = workspace.unwrap_or_default();
        let read = state.reach(i).and_then(|there| {
            let wanted = json!({ "project": project });
            let (remote, args) = state
                .fleet
                .translate(&machine, &local, &wanted, &*client, &*there)?;
            let project = args["project"].as_str().unwrap_or_default();
            Some(read_history(&there, Some(remote), project, &id, before))
        });
        return match (read, before) {
            (Some(Ok(task)), _) => {
                if before.is_none() {
                    state.fleet.remember_task(&machine, &id, &task);
                }
                Ok(task)
            }
            (Some(Err(e)), None) if e.code == "app_unavailable" => {
                Ok(state.fleet.offline_task(&machine, &local, &id))
            }
            (None, None) => Ok(state.fleet.offline_task(&machine, &local, &id)),
            (Some(Err(e)), _) => Err(failure(&e)),
            (None, Some(_)) => Err(machine_off()),
        };
    }
    read_history(&client, workspace, &project, &id, before).map_err(|e| failure(&e))
}
fn read_history(
    client: &Client,
    workspace: Option<String>,
    project: &str,
    id: &str,
    before: Option<u64>,
) -> Result<Value, Error> {
    if !client.push_stream() {
        let reply = client.invoke(
            "load_session",
            workspace,
            json!({"project":project,"id":id}),
        )?;
        let Some(mut session) = reply.get("value").cloned() else {
            let mut error = Error::new("operation_failed");
            error.detail = reply.get("error").cloned().unwrap_or_default();
            return Err(error);
        };
        let total = session["turns"].as_array().map_or(0, Vec::len);
        session["history"] =
            json!({"total":total,"start":0,"end":total,"limit":total,"has_more":false});
        return Ok(session);
    }
    client.request(
        "service history",
        workspace,
        json!({"project":project,"id":id,"turns":HISTORY_TURNS,"before":before}),
        Duration::from_secs(30),
    )
}
#[tauri::command]
pub(super) fn service_prepare_update() -> Result<(), Value> {
    // El cliente y el host se actualizan por separado; Windows ya no reemplaza el ejecutable del host.
    Ok(())
}
#[tauri::command]
pub(super) fn service_cancel_update() -> Result<(), Value> {
    Ok(())
}

/// El token de cliente de vida corta de la cuenta de Danil, con el que la ventana
/// lista las otras computadoras de la persona y les abre una sesión del relay. La
/// credencial de la máquina no sale del motor; uno sin `danil_client_token` lo rechaza.
/// `account` nombra la sesión de la cuenta del workspace; sin él, la principal.
#[tauri::command(async)]
pub(super) fn account_relay_token(
    app: tauri::AppHandle,
    account: Option<String>,
) -> Result<Value, Value> {
    let state = app
        .try_state::<Arc<State>>()
        .ok_or_else(|| failure(&Error::new("app_unavailable")))?;
    let args = match account.filter(|a| !a.trim().is_empty()) {
        Some(account) => json!({ "account": account }),
        None => json!({}),
    };
    invoke(&state, "danil_client_token", args)
}

/// Las máquinas de esta ventana y cuál está activa. Una remota inactiva cuenta
/// como encendida solo si su motor contesta ya: preguntar no la enciende.
#[tauri::command(async)]
pub(super) fn machine_list(app: tauri::AppHandle) -> Result<Value, Value> {
    let state = app
        .try_state::<Arc<State>>()
        .ok_or_else(|| failure(&Error::new("app_unavailable")))?;
    let active = HOME;
    let workspace = state.workspace();
    let list: Vec<Value> = state
        .machines
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let on = if i == active {
                answers(&state.client())
            } else if let Some(client) = m.parked.lock().unwrap_or_else(|p| p.into_inner()).as_ref()
            {
                answers(client)
            } else if m.wake.is_some() {
                // Leer su selección no dice si contesta: apagada, el túnel ya no llega.
                state.reach(i).is_some_and(|client| answers(&client))
            } else {
                true
            };
            // Si tiene este workspace: solo se sabe preguntándole, y apagada no se pregunta.
            let hosts = match &workspace {
                _ if i == active => Some(true),
                Some(local) if state.fleet.linked(&m.id, local) => Some(true),
                Some(local) if on => state.reach(i).map(|there| {
                    let home = state.client();
                    state.fleet.counterpart_workspace(&m.id, local, &*home, &*there).is_some()
                }),
                _ => None,
            };
            json!({"id": m.id, "local": m.wake.is_none(), "active": i == active, "on": on, "hosts": hosts})
        })
        .collect();
    Ok(json!(list))
}
