use std::{io, path::Path, process::Command};

// AppRun y los hooks GTK/GStreamer de Tauri alteran estas variables antes de abrir la ventana.
const BUNDLE_ENV: &[&str] = &[
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "APPDIR",
    "ARGV0",
    "OWD",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GSETTINGS_SCHEMA_DIR",
    "GIO_MODULE_DIR",
    "GIO_EXTRA_MODULES",
    "XDG_DATA_DIRS",
    "GI_TYPELIB_PATH",
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
    "GTK_PATH",
    "GTK_IM_MODULE_FILE",
    "GTK_THEME",
    "GDK_BACKEND",
    "PYTHONHOME",
    "PYTHONPATH",
    "PYTHONDONTWRITEBYTECODE",
    "PERLLIB",
    "QT_PLUGIN_PATH",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_PATH",
    "GST_PLUGIN_SCANNER",
    "GST_PTP_HELPER",
    "GST_REGISTRY_REUSE_PLUGIN_SCANNER",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "GST_PLUGIN_PATH_1_0",
    "GST_PLUGIN_SCANNER_1_0",
    "GST_PTP_HELPER_1_0",
    "GST_PLUGIN_SYSTEM_PATH_0_10",
    "GST_PLUGIN_PATH_0_10",
    "GST_PLUGIN_SCANNER_0_10",
    "GST_PTP_HELPER_0_10",
];

pub(super) fn prepare(command: &mut Command, directory: &Path) -> io::Result<()> {
    let directory = directory.canonicalize()?;
    command.current_dir(&directory);
    if let Some(appdir) = std::env::var_os("APPDIR") {
        let appdir = Path::new(&appdir).canonicalize()?;
        if directory.starts_with(&appdir) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "engine cwd inside AppDir",
            ));
        }
        // APPIMAGE identifica la instancia en el motor; no es una ruta de búsqueda de bibliotecas.
        for name in BUNDLE_ENV {
            let original = format!("{name}_ORIG");
            command.env_remove(name).env_remove(&original);
            if let Some(value) = std::env::var_os(&original) {
                command.env(name, value);
            }
        }
        let path = std::env::var_os("PATH_ORIG").or_else(|| std::env::var_os("PATH"));
        command.env_remove("PATH_ORIG");
        if let Some(path) = path {
            let cwd = std::env::current_dir()?;
            let entries = std::env::split_paths(&path).filter_map(|entry| {
                let absolute = if entry.is_absolute() {
                    entry
                } else {
                    cwd.join(entry)
                };
                let resolved = absolute.canonicalize().unwrap_or(absolute);
                (!resolved.starts_with(&appdir)).then_some(resolved)
            });
            command.env(
                "PATH",
                std::env::join_paths(entries).map_err(io::Error::other)?,
            );
        }
    }
    cloexec(command)
}

fn cloexec(command: &mut Command) -> io::Result<()> {
    use std::os::unix::process::CommandExt;
    let mut limit = unsafe { libc::sysconf(libc::_SC_OPEN_MAX) };
    if limit < 0 {
        return Err(io::Error::last_os_error());
    }
    // Un descriptor abierto antes de bajar RLIMIT_NOFILE puede superar el límite actual.
    for entry in std::fs::read_dir("/proc/self/fd")? {
        if let Some(fd) = entry?
            .file_name()
            .to_str()
            .and_then(|s| s.parse::<libc::c_int>().ok())
        {
            limit = limit.max(libc::c_long::from(fd) + 1);
        }
    }
    // CLOEXEC conserva el pipe interno de Command hasta exec; cerrar todo aquí rompería spawn.
    unsafe {
        command.pre_exec(move || {
            if libc::syscall(
                libc::SYS_close_range,
                3u32,
                u32::MAX,
                libc::CLOSE_RANGE_CLOEXEC,
            ) == 0
            {
                return Ok(());
            }
            for fd in 3..limit {
                let flags = libc::fcntl(fd as libc::c_int, libc::F_GETFD);
                if flags >= 0 {
                    if libc::fcntl(fd as libc::c_int, libc::F_SETFD, flags | libc::FD_CLOEXEC) < 0 {
                        return Err(io::Error::last_os_error());
                    }
                } else if io::Error::last_os_error().raw_os_error() != Some(libc::EBADF) {
                    return Err(io::Error::last_os_error());
                }
            }
            Ok(())
        });
    }
    Ok(())
}
