//! Ventana habitual conectada exclusivamente al motor privado seleccionado.
//! Sin argumentos usa el motor empaquetado; una raíz de 0.2.74 pasa antes por el traspaso.
mod desktop;
mod engine;
pub mod env;
mod launcher;
mod legacy;
mod local_image;
mod proxy;
mod sites;
mod startup;
pub mod util;
use std::{path::PathBuf, sync::Arc};
use tauri::{Emitter, Manager};
use terminus_engine_client::Client;
use terminus_engine_protocol::{Error, Result};

pub fn launch() -> Result<()> {
    let result = open();
    if let Err(error) = &result {
        startup::show(error);
    }
    result
}

fn open() -> Result<()> {
    let args: Vec<_> = std::env::args_os().collect();
    let autostart = args.len() == 1;
    let mut paths = None;
    let selection = match args.as_slice() {
        [_] => {
            let found = engine::paths()?;
            let ensured = match launcher::reason(&found) {
                Some(reason) => Err(reason),
                None => match engine::ensure(&found, false) {
                    Err(error) if error.code == "adoption_required" => Err("readopt"),
                    other => Ok(other?),
                },
            };
            match ensured {
                Ok(selection) => {
                    paths = Some(found);
                    selection
                }
                Err(reason) => {
                    engine::prepare(&found)?;
                    start(None, true, launcher::Launcher::handoff(found, reason));
                    return Ok(());
                }
            }
        }
        [_, flag, path] if flag == "--external-host" => PathBuf::from(path),
        _ => return Err(Error::new("invalid_request")),
    };
    let client = Client::select(&selection)?;
    let directory = &client.selection().window_data;
    terminus_engine_client::private_directory(directory)?;
    let window = std::fs::canonicalize(directory)?;
    let data = std::fs::canonicalize(&client.selection().data_directory)?;
    if window.starts_with(&data) || data.starts_with(&window) {
        return Err(Error::new("invalid_request"));
    }
    start(
        Some(Arc::new(client)),
        autostart,
        launcher::Launcher::ready(paths),
    );
    Ok(())
}

/// `--stop-engine`, para el instalador: 0 paró, 3 trabaja (no se toca), 1 no contestó.
pub fn stop_engine() -> i32 {
    match engine::stop() {
        engine::Stopped::Done => 0,
        engine::Stopped::Busy => 3,
        engine::Stopped::Unanswered => 1,
    }
}

pub fn run(client: Arc<Client>) {
    start(Some(client), false, launcher::Launcher::ready(None));
}

fn title(app: &tauri::AppHandle, client: &Client) -> String {
    let base = app
        .config()
        .app
        .windows
        .first()
        .map_or("Terminus", |w| w.title.as_str())
        .to_owned();
    format!(
        "{base} · {} · {}",
        client.runtime(),
        startup::engine_build(client.status())
    )
}

/// Sin cliente, la ventana abre en el traspaso y el lanzador registra el estado al conectar.
fn start(client: Option<Arc<Client>>, autostart: bool, launcher: launcher::Launcher) {
    let _ = desktop::STARTED.set(std::time::Instant::now());
    let state = client.map(|client| Arc::new(proxy::State::new(client, autostart)));
    let context = tauri::generate_context!();
    let Some(window_data) = state
        .as_ref()
        .map(|state| state.client().selection().window_data.clone())
        .or_else(|| launcher.window())
    else {
        return;
    };
    let launcher = Arc::new(launcher);
    let starting = launcher.clone();
    let log = tauri_plugin_log::Builder::default()
        .targets([tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::Folder {
                path: window_data.clone(),
                file_name: Some("window".into()),
            },
        )])
        .build();
    tauri::Builder::default()
        .manage(launcher)
        .setup(move |app| {
            if let Some(state) = state {
                app.manage(state);
            }
            #[cfg(target_os = "macos")]
            desktop::configure_close_menu(app)?;
            let mut config = app.config().app.windows[0].clone();
            config.url = tauri::WebviewUrl::App("index.html".into());
            if let Some(state) = app.try_state::<Arc<proxy::State>>() {
                config.title = title(app.handle(), &state.client());
            }
            let handle = app.handle().clone();
            tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
                .data_directory(window_data.join("webview"))
                .incognito(true)
                .on_navigation(move |url| {
                    if url.scheme() == "tauri"
                        || url.host_str() == Some("tauri.localhost")
                        || url.as_str() == "about:srcdoc"
                    {
                        return true;
                    }
                    let _ = handle.emit("sitio-pedido", url.to_string());
                    false
                })
                .build()?;
            launcher::start(app.handle().clone(), starting.clone());
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol(
            local_image::SCHEME,
            |_ctx, request, responder| local_image::atender(request, responder),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(log)
        .invoke_handler(proxy::with_desktop(tauri::generate_handler![
            desktop::request_close,
            desktop::window_ready,
            desktop::window_vitals,
            launcher::launcher_state,
            launcher::launcher_continue,
            proxy::service_poll,
            proxy::service_prepare_update,
            proxy::service_cancel_update,
            sites::site_sweep,
            sites::site_open,
            sites::site_place,
            sites::site_hide,
            sites::site_close,
            sites::site_go,
            sites::site_navigate,
            sites::site_reload,
            sites::site_open_external
        ]))
        .build(context)
        .expect("tauri extracted client")
        .run(move |app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(state) = app.try_state::<Arc<proxy::State>>() {
                    state.close();
                }
            }
        });
}
