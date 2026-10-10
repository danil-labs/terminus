use std::ffi::OsStr;
#[cfg(unix)]
use std::os::unix::process::CommandExt;

pub fn requested(first: Option<&OsStr>) -> bool {
    first.is_some_and(|arg| arg != "--external-host" && arg != "--stop-engine")
}

// exec conserva los descriptores, las señales y el código de salida sin iniciar Tauri.
#[cfg(unix)]
pub fn forward() -> std::io::Result<()> {
    let exe = std::env::current_exe()?.with_file_name("seldon-runtime");
    Err(std::process::Command::new(exe)
        .args(std::env::args_os().skip(1))
        .exec())
}

#[cfg(test)]
mod tests {
    use super::requested;
    use std::ffi::OsStr;

    #[test]
    fn window_and_installer_keep_their_entry_points() {
        assert!(!requested(None));
        assert!(!requested(Some(OsStr::new("--external-host"))));
        assert!(!requested(Some(OsStr::new("--stop-engine"))));
    }

    #[test]
    fn commands_and_global_flags_go_to_the_engine() {
        for arg in [
            "task",
            "instances",
            "--help",
            "--version",
            "--instance",
            "unknown",
        ] {
            assert!(requested(Some(OsStr::new(arg))));
        }
    }
}
