//! The Terminus binary: opens the window against the engine named by
//! `--external-host <selection.json>`.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(unix)]
mod cli;

fn main() {
    #[cfg(unix)]
    if cli::requested(std::env::args_os().nth(1).as_deref()) {
        if let Err(error) = cli::forward() {
            eprintln!("cli.error.engine_start_failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args_os()
        .nth(1)
        .is_some_and(|arg| arg == "--stop-engine")
    {
        std::process::exit(app_lib::stop_engine());
    }
    if let Err(error) = app_lib::launch() {
        eprintln!("{}", error.message_key);
        std::process::exit(1);
    }
}
