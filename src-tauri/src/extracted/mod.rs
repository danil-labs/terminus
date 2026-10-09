//! Ventana habitual conectada exclusivamente al motor privado seleccionado.
//! No importa, descubre ni arranca el backend original en este build.
mod desktop;
mod engine;
pub mod env;
mod local_image;
mod proxy;
mod sites;
mod startup;
pub mod util;
use std::{path::PathBuf, sync::Arc};
use tauri::Emitter;
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
    let selection = match args.as_slice() {
        [_] => engine::ensure(&engine::paths()?)?,
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
    run(Arc::new(client));
    Ok(())
}

pub fn run(client: Arc<Client>) {
    let _ = desktop::STARTED.set(std::time::Instant::now());
    let state = Arc::new(proxy::State::new(client));
    let context = tauri::generate_context!();
    let window_data = state.client.selection().window_data.clone();
    let runtime = state.client.runtime().to_owned();
    let engine = startup::engine_build(state.client.status());
    let log = tauri_plugin_log::Builder::default()
        .targets([tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::Folder {
                path: window_data.clone(),
                file_name: Some("window".into()),
            },
        )])
        .build();
    tauri::Builder::default()
        .manage(state.clone())
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            desktop::configure_close_menu(app)?;
            let mut config = app.config().app.windows[0].clone();
            config.url = tauri::WebviewUrl::App("index.html".into());
            config.title = format!("{} · {} · {}", config.title, runtime, engine);
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
        .run(move |_app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                state.close();
            }
        });
}
