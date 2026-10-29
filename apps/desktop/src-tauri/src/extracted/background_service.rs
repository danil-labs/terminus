//! Entrada sin Tauri para el wrapper firmado y la preparación offline del LaunchAgent.
use std::{ffi::OsString, path::Path};

#[cfg(target_os = "macos")]
#[path = "background_service_macos.rs"]
mod macos;

pub fn dispatch() {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let Some(flag) = args.first() else { return };
    if flag != "--background-host" && flag != "--prepare-background-host" {
        return;
    }
    let result = match args.as_slice() {
        [flag] if flag == "--background-host" => run(None),
        [flag, output] if flag == "--prepare-background-host" => run(Some(Path::new(output))),
        _ => Err(std::io::Error::other("invalid_request")),
    };
    let code = match result {
        Ok(code) => code,
        Err(error) => {
            eprintln!("background-host: {error}");
            1
        }
    };
    std::process::exit(code);
}

fn run(output: Option<&Path>) -> std::io::Result<i32> {
    #[cfg(target_os = "macos")]
    {
        macos::run(output)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = output;
        Err(std::io::Error::other("background_host_requires_macos"))
    }
}
