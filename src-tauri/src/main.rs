//! The Terminus binary: opens the window against the engine named by
//! `--external-host <selection.json>`.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(error) = app_lib::launch() {
        eprintln!("{}", error.message_key);
        std::process::exit(1);
    }
}
