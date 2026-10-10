//! The Terminus binary: opens the window against the engine named by
//! `--external-host <selection.json>`.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
#[cfg(windows)]
mod console;

fn main() {
    cli::dispatch();
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
