//! Sin `--external-host`, la ventana usa el motor que viaja con ella: reutiliza
//! uno vivo sobre su carpeta de datos o lanza `seldon-runtime` junto al
//! ejecutable. La identidad es `ai.danil.seldon.dev` y la raíz vive aparte de la
//! de `ai.danil.terminus`: nunca se leen sus datos ni su llavero. Un candado sobre
//! la raíz evita que dos ventanas arranquen dos motores. Ver `docs/engine-client.md`.
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use terminus_engine_protocol::{Error, Result, Selection, VERSION};

pub const IDENTITY: &str = "ai.danil.seldon.dev";
const START_TIMEOUT: Duration = Duration::from_secs(30);

pub struct Paths {
    pub root: PathBuf,
    data: PathBuf,
    resources: PathBuf,
    window: PathBuf,
    selection: PathBuf,
    launch_log: PathBuf,
}

pub fn paths() -> Result<Paths> {
    let base = dirs::data_local_dir().ok_or_else(|| Error::new("invalid_request"))?;
    let root = base.join(IDENTITY);
    Ok(Paths {
        data: root.join("engine"),
        resources: root.join("resources"),
        window: root.join("window"),
        selection: root.join("selection.json"),
        launch_log: root.join("engine-launch.log"),
        root,
    })
}

/// La selección del motor de esta ventana: el vivo sobre la raíz o uno recién lanzado.
pub fn ensure(paths: &Paths) -> Result<PathBuf> {
    for dir in [&paths.root, &paths.data, &paths.resources, &paths.window] {
        private_dir(dir)?;
    }
    let lock = File::create(paths.root.join("launch.lock"))?;
    lock.lock()?;
    let endpoint = paths.data.join("seldon-endpoint.json");
    if let Ok((found, status)) = terminus_engine_client::probe(&endpoint) {
        return write_selection(paths, &endpoint, &found, &status);
    }
    let mut child = spawn(paths)?;
    let deadline = Instant::now() + START_TIMEOUT;
    while Instant::now() < deadline {
        if child.try_wait()?.is_some() {
            return Err(failed(paths));
        }
        if let Ok((found, status)) = terminus_engine_client::probe(&endpoint) {
            if found.pid == child.id() {
                return write_selection(paths, &endpoint, &found, &status);
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(failed(paths))
}

fn spawn(paths: &Paths) -> Result<Child> {
    let exe = std::env::current_exe()?
        .with_file_name(format!("seldon-runtime{}", std::env::consts::EXE_SUFFIX));
    if !exe.is_file() {
        return Err(Error {
            detail: serde_json::json!(exe),
            ..Error::new("engine_missing")
        });
    }
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.launch_log)?;
    // proceso largo: a propósito. El motor sobrevive a la ventana y se apaga solo sin clientes.
    let mut command = Command::new(exe);
    crate::util::no_console_window(&mut command)
        .arg("--data-dir")
        .arg(&paths.data)
        .arg("--resource-dir")
        .arg(&paths.resources)
        .args(["--identity", IDENTITY])
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log.try_clone()?);
    let (child, launch) = spawn_detached(&mut command)?;
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    let _ = writeln!(&log, "[ventana] unix={seconds} pid={} {launch}", child.id());
    Ok(child)
}

// Sale del job de quien lanzó la ventana para sobrevivirla; si ese job no lo permite, queda dentro.
// Devuelve, para engine-launch.log, si la ventana y el motor quedaron en un job.
#[cfg(windows)]
fn spawn_detached(command: &mut Command) -> std::io::Result<(Child, String)> {
    use std::os::windows::{io::AsRawHandle, process::CommandExt};
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let flags = CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW;
    let launcher = in_job(unsafe { windows_sys::Win32::System::Threading::GetCurrentProcess() });
    command.creation_flags(flags | CREATE_BREAKAWAY_FROM_JOB);
    let (child, breakaway) = match command.spawn() {
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            command.creation_flags(flags);
            (command.spawn()?, "rechazado")
        }
        other => (other?, "pedido"),
    };
    let engine = in_job(child.as_raw_handle() as _);
    Ok((
        child,
        format!("ventana_en_job={launcher} breakaway={breakaway} motor_en_job={engine}"),
    ))
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
        (false, _) => "desconocido",
        (true, true) => "si",
        (true, false) => "no",
    }
}

#[cfg(unix)]
fn spawn_detached(command: &mut Command) -> std::io::Result<(Child, String)> {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
    Ok((command.spawn()?, "grupo_propio".into()))
}

fn failed(paths: &Paths) -> Error {
    Error {
        detail: serde_json::json!(paths.root),
        ..Error::new("engine_start_failed")
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

#[cfg(unix)]
fn private_dir(dir: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(windows)]
fn private_dir(dir: &Path) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    Ok(())
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
