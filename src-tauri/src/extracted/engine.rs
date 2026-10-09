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
            resources: root.join("resources"),
            window: root.join("window"),
            selection: root.join("selection.json"),
            launch_log: root.join("engine-launch.log"),
            root,
        });
    };
    Ok(Paths {
        identity,
        data: root.join("engine"),
        resources: root.join("resources"),
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

/// Las carpetas de la ventana, antes de abrirla aunque el motor todavía no exista.
pub fn prepare(paths: &Paths) -> Result<()> {
    for dir in [&paths.root, &paths.resources, &paths.window] {
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
    let deadline = Instant::now() + START_TIMEOUT;
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
        .arg("--identity")
        .arg(&paths.identity)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    if paths.identity == PRODUCTION {
        command.arg("--production-identity");
    }
    if adopt {
        command.arg("--adopt-existing");
    }
    log::info!(
        "[engine] starting identity={} adopt={adopt}",
        paths.identity
    );
    Ok(spawn_detached(&mut command)?)
}

// Sale del job de quien lanzó la ventana para sobrevivirla; si ese job no lo permite, queda dentro.
#[cfg(windows)]
fn spawn_detached(command: &mut Command) -> std::io::Result<Child> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let flags = CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW;
    command.creation_flags(flags | CREATE_BREAKAWAY_FROM_JOB);
    match command.spawn() {
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            command.creation_flags(flags);
            command.spawn()
        }
        other => other,
    }
}

#[cfg(unix)]
fn spawn_detached(command: &mut Command) -> std::io::Result<Child> {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
    command.spawn()
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
