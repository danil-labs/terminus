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
use terminus_engine_client::Client;
use terminus_engine_protocol::{Error, StreamPage};

type OwnedWatch = (Option<String>, Arc<AtomicBool>);

pub(super) struct State {
    client: RwLock<Arc<Client>>,
    autostart: bool,
    restarts: Mutex<Vec<Instant>>,
    restart_failure: Mutex<Option<Error>>,
    workspace: Mutex<Option<String>>,
    closed: AtomicBool,
    in_flight: AtomicUsize,
    stream_gap: AtomicBool,
    watchers: Mutex<std::collections::BTreeMap<String, OwnedWatch>>,
    clones: Mutex<std::collections::BTreeMap<String, Option<String>>>,
    streams: Mutex<Vec<(String, Option<String>)>>,
}
impl State {
    pub fn new(client: Arc<Client>, autostart: bool) -> Self {
        Self {
            client: RwLock::new(client),
            autostart,
            restarts: Mutex::new(Vec::new()),
            restart_failure: Mutex::new(None),
            workspace: Mutex::new(None),
            closed: AtomicBool::new(false),
            in_flight: AtomicUsize::new(0),
            stream_gap: AtomicBool::new(false),
            watchers: Mutex::new(Default::default()),
            clones: Mutex::new(Default::default()),
            streams: Mutex::new(Vec::new()),
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
        if !self.autostart {
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
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        let streams = std::mem::take(&mut *self.streams.lock().unwrap_or_else(|p| p.into_inner()));
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let watchers =
            std::mem::take(&mut *self.watchers.lock().unwrap_or_else(|p| p.into_inner()));
        for (id, (workspace, cancel)) in watchers {
            cancel.store(true, Ordering::SeqCst);
            if std::time::Instant::now() >= deadline {
                break;
            }
            let _ = self.client().request(
                "service invoke",
                workspace,
                json!({"command":"unwatch_task_tree","arguments":{"id":id}}),
                Duration::from_millis(300),
            );
        }
        for (id, workspace) in streams {
            if std::time::Instant::now() >= deadline {
                break;
            }
            let _ = self.client().request(
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
pub(super) fn desktop_command(name: &str) -> bool {
    command(name).is_some_and(|c| c["kind"] == "desktop")
        || matches!(name, "launcher_state" | "launcher_continue")
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
    let workspace = if name == "unwatch_task_tree" {
        let watchers = state.watchers.lock().unwrap_or_else(|p| p.into_inner());
        args["id"]
            .as_str()
            .and_then(|id| watchers.get(id))
            .map(|(scope, _)| scope.clone())
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
    let job = move || {
        let _slot = slot;
        if let Some((key, channel)) = channel {
            stream(state, &name, args, workspace, key, channel, worker);
            return;
        }
        let result = state
            .client()
            .invoke(&name, workspace.clone(), args.clone())
            .map_err(|e| failure(&e))
            .and_then(reply);
        if let Ok(value) = &result {
            if name == "unwatch_task_tree" {
                if let Some((_, cancel)) = args["id"].as_str().and_then(|id| {
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
                "set_active_workspace" => args["id"].as_str(),
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
fn stream(
    state: Arc<State>,
    name: &str,
    arguments: Value,
    workspace: Option<String>,
    key: String,
    channel: tauri::ipc::Channel<Value>,
    resolver: Arc<Mutex<Option<tauri::ipc::InvokeResolver>>>,
) {
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
    let start = state.client().request(
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
        .push((id.clone(), workspace.clone()));
    let cancel = Arc::new(AtomicBool::new(false));
    let mut cursor = None;
    let result = (|| -> Result<(), Value> {
        while !state.closed.load(Ordering::SeqCst) && !cancel.load(Ordering::SeqCst) {
            let value = state
                .client()
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
                            .or_insert_with(|| (workspace.clone(), cancel.clone()));
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
    let _ = state.client().request(
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
        .retain(|_, (_, value)| !Arc::ptr_eq(value, &cancel));
    state
        .streams
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .retain(|(key, _)| key != &id);
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
    if runtime
        .as_ref()
        .is_some_and(|id| id != state.client().runtime())
    {
        return Err(failure(&Error::new("version_mismatch")));
    }
    let polled = state.client().request(
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
            // Sin motor que relanzar (un antivirus puede apartarlo), el aviso dice eso y no «no responde».
            if let Err(restart) = state.restart() {
                let shown = if restart.code == "engine_missing" {
                    restart
                } else {
                    error
                };
                return Err(failure(&shown));
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&super::title(&app, &state.client()));
            }
            return Ok(
                json!({"cursor":null,"gap":false,"replay":true,"runtime":state.client().runtime(),"reset":true}),
            );
        }
        other => other.map_err(|e| failure(&e))?,
    };
    if let Some(events) = page["events"].as_array() {
        for event in events {
            let Some(name) = event["name"].as_str() else {
                return Err(failure(&Error::new("invalid_request")));
            };
            if !manifest()["events"]
                .as_array()
                .is_some_and(|names| names.iter().any(|v| v == name))
            {
                return Err(failure(&Error::new("invalid_request")));
            }
            if setup != Some(true) || matches!(name, "bootstrap" | "bootstrap-run" | "toolchain") {
                let _ = app.emit(name, &event["payload"]);
            }
        }
    }
    Ok(
        json!({"cursor":page["cursor"],"gap":page["gap"] == true || state.stream_gap.swap(false, Ordering::SeqCst),"replay":page["replay"],"runtime":state.client().runtime(),"reset":false}),
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
