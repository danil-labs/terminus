//! Sin `--external-host`, la ventana usa el motor que viaja con ella: reutiliza
//! uno vivo sobre su carpeta de datos o lanza `seldon-runtime` junto al
//! ejecutable. Un release abre la raíz de `ai.danil.terminus`, la de 0.2.74; el
//! laboratorio usa `ai.danil.seldon.dev` y nunca esa raíz. Un candado evita que
//! dos ventanas arranquen dos motores. Ver `docs/engine-client.md`.
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use terminus_engine_protocol::{Error, Result, Selection, VERSION};

pub const PRODUCTION: &str = "ai.danil.terminus";
pub const LAB_IDENTITY: &str = "ai.danil.seldon.dev";
const START_TIMEOUT: Duration = Duration::from_secs(30);
// Adoptar una raíz real de 0.2.74 tardó unos 25 s; el traspaso enseña el paso mientras tanto.
const ADOPT_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Clone)]
pub struct Paths {
    pub identity: String,
    pub root: PathBuf,
    pub data: PathBuf,
    resources: PathBuf,
    pub window: PathBuf,
    selection: PathBuf,
    pub launch_log: PathBuf,
}

/// Con la identidad de producción los datos son la raíz de 0.2.74 y lo de la
/// ventana vive al lado, en `ai.danil.terminus-window`: dentro no se admite.
pub fn paths() -> Result<Paths> {
    let base = dirs::data_local_dir().ok_or_else(|| Error::new("invalid_request"))?;
    let Some((identity, root)) = lab(&base) else {
        let root = base.join(format!("{PRODUCTION}-window"));
        return Ok(Paths {
            identity: PRODUCTION.into(),
            data: base.join(PRODUCTION),
            resources: installed_resources(&root)?,
            window: root.join("window"),
            selection: root.join("selection.json"),
            launch_log: root.join("engine-launch.log"),
            root,
        });
    };
    Ok(Paths {
        identity,
        data: root.join("engine"),
        resources: installed_resources(&root)?,
        window: root.join("window"),
        selection: root.join("selection.json"),
        launch_log: root.join("engine-launch.log"),
        root,
    })
}

/// El laboratorio: `TERMINUS_LAB_ROOT` o `TERMINUS_LAB_IDENTITY` en cualquier build, o
/// un build de desarrollo. Nunca con la identidad de producción.
fn lab(base: &Path) -> Option<(String, PathBuf)> {
    let identity = std::env::var("TERMINUS_LAB_IDENTITY")
        .ok()
        .filter(|i| !i.is_empty() && i != PRODUCTION);
    let root = std::env::var_os("TERMINUS_LAB_ROOT")
        .map(PathBuf::from)
        .filter(|root| root.is_absolute());
    if identity.is_none() && root.is_none() && !cfg!(debug_assertions) {
        return None;
    }
    let identity = identity.unwrap_or_else(|| LAB_IDENTITY.into());
    let root = root.unwrap_or_else(|| base.join(&identity));
    Some((identity, root))
}

/// Los recursos de la instalación (`lenguas/`), los mismos que `resource_dir()` de Tauri.
/// Dentro de un AppImage el montaje desaparece con la ventana: se copian a `<root>/resources`.
fn installed_resources(root: &Path) -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let dir = exe.parent().ok_or_else(|| Error::new("invalid_request"))?;
    if cfg!(target_os = "macos") && dir.ends_with("Contents/MacOS") {
        return Ok(dir.join("../Resources").canonicalize()?);
    }
    #[cfg(target_os = "linux")]
    if let Some(appdir) =
        std::env::var_os("APPDIR").filter(|_| std::env::var_os("APPIMAGE").is_some())
    {
        // productName de tauri.conf.json: el bundle de Linux pone ahí los recursos.
        let mounted = PathBuf::from(appdir).join("usr/lib/Terminus");
        let copy = root.join("resources");
        super::legacy::mirror(&mounted, &copy)?;
        return Ok(copy);
    }
    let _ = root;
    Ok(dir.to_path_buf())
}

/// Las carpetas de la ventana, antes de abrirla aunque el motor todavía no exista.
pub fn prepare(paths: &Paths) -> Result<()> {
    for dir in [&paths.root, &paths.window] {
        private_dir(dir)?;
    }
    Ok(())
}

/// La selección del motor de esta ventana: el vivo sobre la raíz o uno recién lanzado.
/// `adopt` pasa `--adopt-existing`: solo tras el traspaso que la persona aceptó.
pub fn ensure(paths: &Paths, adopt: bool) -> Result<PathBuf> {
    prepare(paths)?;
    // La raíz de 0.2.74 ya existe y es del motor validarla; una nueva la crea él.
    if paths.identity != PRODUCTION {
        private_dir(&paths.data)?;
    }
    let lock = File::create(paths.root.join("launch.lock"))?;
    lock.lock()?;
    let endpoint = paths.data.join("seldon-endpoint.json");
    if let Ok((found, status)) = terminus_engine_client::probe(&endpoint) {
        return write_selection(paths, &endpoint, &found, &status);
    }
    let offset = std::fs::metadata(&paths.launch_log).map_or(0, |m| m.len());
    let mut child = spawn(paths, adopt)?;
    let deadline = Instant::now() + if adopt { ADOPT_TIMEOUT } else { START_TIMEOUT };
    while Instant::now() < deadline {
        if child.try_wait()?.is_some() {
            return Err(failed(paths, offset));
        }
        if let Ok((found, status)) = terminus_engine_client::probe(&endpoint) {
            if found.pid == child.id() {
                return write_selection(paths, &endpoint, &found, &status);
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(failed(paths, offset))
}

pub enum Stopped {
    /// Aceptó y salió.
    Done,
    /// Se negó con `task_busy` por trabajo: turnos, descargas u operaciones.
    Busy,
    /// No contestó, no salió, o solo lo retienen observadores: el instalador lo para.
    Unanswered,
}

/// Para el instalador: pide `service stop` al motor de esta raíz, que se niega si trabaja.
pub fn stop() -> Stopped {
    let Ok(paths) = paths() else {
        return Stopped::Unanswered;
    };
    let endpoint = paths.data.join("seldon-endpoint.json");
    // Una orden de una ventana que se acaba de cerrar termina sola; un turno o una descarga, no.
    let settle = Instant::now() + Duration::from_secs(20);
    loop {
        match terminus_engine_client::request_endpoint(
            &endpoint,
            "service stop",
            Duration::from_secs(5),
        ) {
            Ok((found, _)) => {
                let deadline = Instant::now() + Duration::from_secs(30);
                while Instant::now() < deadline {
                    if !super::legacy::alive(found.pid) {
                        return Stopped::Done;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                return Stopped::Unanswered;
            }
            Err(error) if error.code == "task_busy" && working(&error.detail) => {
                if !only_operations(&error.detail) || Instant::now() >= settle {
                    return Stopped::Busy;
                }
                std::thread::sleep(Duration::from_secs(1));
            }
            Err(_) => return Stopped::Unanswered,
        }
    }
}

fn only_operations(busy: &serde_json::Value) -> bool {
    busy.is_object() && busy["turns"].as_u64().unwrap_or(0) == 0 && busy["downloading"] != true
}

// Un `watch_task_tree` de una ventana cerrada a la fuerza no caduca y retiene al motor; no es trabajo.
fn working(busy: &serde_json::Value) -> bool {
    !busy.is_object()
        || busy["turns"].as_u64().unwrap_or(0) > 0
        || busy["downloading"] == true
        || busy["operations"].as_array().is_some_and(|operations| {
            operations.iter().any(|operation| {
                !matches!(
                    operation["command"].as_str(),
                    Some("watch_task_tree" | "list_session_git")
                )
            })
        })
}

fn spawn(paths: &Paths, adopt: bool) -> Result<Child> {
    let exe = std::env::current_exe()?
        .with_file_name(format!("seldon-runtime{}", std::env::consts::EXE_SUFFIX));
    if !exe.is_file() {
        return Err(Error {
            detail: serde_json::json!(exe),
            ..Error::new("engine_missing")
        });
    }
    let exe = super::legacy::stable_engine(&exe, &paths.root)?;
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.launch_log)?;
    // proceso largo: a propósito. El motor sobrevive a la ventana y se apaga solo sin clientes.
    let mut command = Command::new(&exe);
    #[cfg(target_os = "linux")]
    super::linux_engine::prepare(&mut command, &paths.root)?;
    crate::util::no_console_window(&mut command)
        .arg("--data-dir")
        .arg(&paths.data)
        .arg("--resource-dir")
        .arg(&paths.resources)
        .arg("--identity")
        .arg(&paths.identity)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log.try_clone()?);
    if paths.identity == PRODUCTION {
        command.arg("--production-identity");
    }
    if adopt {
        command.arg("--adopt-existing");
    }
    #[cfg(target_os = "macos")]
    let master_pipe = super::master_handoff::prepare(&exe, &paths.identity, &mut command);
    log::info!(
        "[engine] starting identity={} adopt={adopt}",
        paths.identity
    );
    let (child, outside) = spawn_detached(&mut command)?;
    #[cfg(target_os = "macos")]
    drop(master_pipe);
    let _ = writeln!(
        log,
        "window: launched pid={}{}",
        child.id(),
        launch_note(&child, outside)
    );
    Ok(child)
}

// Sale del job de quien lanzó la ventana para sobrevivirla; si ese job no lo permite, queda dentro.
#[cfg(windows)]
fn spawn_detached(command: &mut Command) -> std::io::Result<(Child, bool)> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let flags = CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW;
    command.creation_flags(flags | CREATE_BREAKAWAY_FROM_JOB);
    match command.spawn() {
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            command.creation_flags(flags);
            Ok((command.spawn()?, false))
        }
        other => Ok((other?, true)),
    }
}

/// Si la ventana y el motor quedaron en un Job Object: un job que mata al cerrarse se lleva al motor.
#[cfg(windows)]
fn launch_note(child: &Child, outside: bool) -> String {
    use std::os::windows::io::AsRawHandle;
    let window = in_job(unsafe { windows_sys::Win32::System::Threading::GetCurrentProcess() });
    let breakaway = if outside { "accepted" } else { "refused" };
    let engine = in_job(child.as_raw_handle() as _);
    format!(" window_in_job={window} breakaway={breakaway} engine_in_job={engine}")
}

#[cfg(windows)]
fn in_job(process: windows_sys::Win32::Foundation::HANDLE) -> &'static str {
    let mut result = 0;
    let ok = unsafe {
        windows_sys::Win32::System::JobObjects::IsProcessInJob(
            process,
            std::ptr::null_mut(),
            &mut result,
        )
    };
    match (ok != 0, result != 0) {
        (false, _) => "unknown",
        (true, true) => "yes",
        (true, false) => "no",
    }
}

#[cfg(unix)]
fn launch_note(_child: &Child, _outside: bool) -> String {
    " process_group=own".into()
}

#[cfg(unix)]
fn spawn_detached(command: &mut Command) -> std::io::Result<(Child, bool)> {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
    Ok((command.spawn()?, true))
}

/// La clave con que el motor rechazó el arranque, de lo que escribió en esta corrida.
fn failed(paths: &Paths, offset: u64) -> Error {
    let written = std::fs::read(&paths.launch_log).unwrap_or_default();
    let tail = String::from_utf8_lossy(written.get(offset as usize..).unwrap_or_default());
    let code = tail
        .rsplit_once("cli.error.")
        .map(|(_, rest)| {
            rest.chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect::<String>()
        })
        .filter(|code| {
            matches!(
                code.as_str(),
                "adoption_required" | "service_busy" | "authority_incompatible"
            )
        })
        .unwrap_or_else(|| "engine_start_failed".into());
    Error {
        detail: serde_json::json!(paths.launch_log),
        ..Error::new(&code)
    }
}

fn write_selection(
    paths: &Paths,
    endpoint: &Path,
    found: &terminus_engine_protocol::Endpoint,
    status: &serde_json::Value,
) -> Result<PathBuf> {
    let selection = Selection {
        version: VERSION,
        endpoint: endpoint.to_path_buf(),
        credential: found.token_file.clone(),
        runtime: found.runtime.clone(),
        data_directory: found.data_directory.clone(),
        contract: found.contract.clone(),
        service_build: status["service_build"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        window_data: paths.window.clone(),
    };
    let bytes = serde_json::to_vec(&selection)?;
    // Reescribirla igual invalidaría el cliente de las otras ventanas sobre el mismo motor.
    if std::fs::read(&paths.selection).is_ok_and(|current| current == bytes) {
        return Ok(paths.selection.clone());
    }
    let temporary = paths.selection.with_extension("json.tmp");
    let _ = std::fs::remove_file(&temporary);
    let mut file = private_file(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&temporary, &paths.selection)?;
    Ok(paths.selection.clone())
}

fn private_dir(dir: &Path) -> Result<()> {
    terminus_engine_client::make_private_directory(dir)
}

fn private_file(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}

#[cfg(test)]
mod tests {
    use super::{only_operations, working};
    use serde_json::json;

    #[test]
    fn only_turns_downloads_and_real_operations_keep_the_installer_out() {
        let watchers = json!({"turns": null, "downloading": false, "operations": [
            {"command": "watch_task_tree", "since": 1}, {"command": "list_session_git", "since": 2}]});
        assert!(!working(&watchers));
        assert!(working(
            &json!({"turns": 1, "downloading": false, "operations": []})
        ));
        assert!(working(
            &json!({"turns": null, "downloading": true, "operations": []})
        ));
        assert!(working(
            &json!({"turns": null, "downloading": false, "operations": [
            {"command": "watch_task_tree"}, {"command": "clone_project"}]})
        ));
        assert!(working(&json!(null)));
        assert!(only_operations(
            &json!({"turns": null, "downloading": false, "operations": [{"command": "add_project"}]})
        ));
        assert!(!only_operations(
            &json!({"turns": 2, "downloading": false, "operations": []})
        ));
        assert!(!only_operations(
            &json!({"turns": null, "downloading": true, "operations": []})
        ));
    }
}
