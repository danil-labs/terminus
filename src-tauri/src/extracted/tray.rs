//! Segundo plano: la ventana se oculta y un icono junto al reloj (barra de menús
//! en macOS) dice qué sigue trabajando y deja abrir, detener o salir. Los textos
//! llegan traducidos del front, que es quien tiene el catálogo.
use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

const ID: &str = "terminus-background";

#[derive(Deserialize)]
pub(super) struct Labels {
    tooltip: String,
    header: String,
    open: String,
    stop_all: String,
    quit: String,
}

#[derive(Deserialize)]
pub(super) struct Item {
    title: String,
}

pub(super) fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.remove_tray_by_id(ID);
}

fn menu(app: &AppHandle, labels: &Labels, items: &[Item]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        "tray-header",
        &labels.header,
        false,
        None::<&str>,
    )?)?;
    for (index, item) in items.iter().enumerate() {
        let id = format!("tray-item-{index}");
        menu.append(&MenuItem::with_id(
            app,
            id,
            &item.title,
            false,
            None::<&str>,
        )?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "tray-open",
        &labels.open,
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "tray-stop-all",
        &labels.stop_all,
        !items.is_empty(),
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "tray-quit",
        &labels.quit,
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

/// Oculta la ventana y pone el icono; el front sigue vivo y lo mantiene al día.
#[tauri::command]
pub(super) fn window_to_background(
    app: AppHandle,
    labels: Labels,
    items: Vec<Item>,
) -> Result<(), String> {
    let menu = menu(&app, &labels, &items).map_err(|error| error.to_string())?;
    if let Some(tray) = app.tray_by_id(ID) {
        tray.set_menu(Some(menu))
            .map_err(|error| error.to_string())?;
    } else {
        let mut builder = TrayIconBuilder::with_id(ID)
            .menu(&menu)
            .tooltip(&labels.tooltip)
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "tray-open" => show_window(app),
                "tray-stop-all" => {
                    let _ = app.emit("tray-stop-all", ());
                }
                "tray-quit" => {
                    let _ = app.emit("tray-quit", ());
                }
                _ => {}
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        builder.build(&app).map_err(|error| error.to_string())?;
    }
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Lo que dice el icono mientras la ventana está oculta; sin icono no hace nada.
#[tauri::command]
pub(super) fn tray_update(app: AppHandle, labels: Labels, items: Vec<Item>) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(ID) else {
        return Ok(());
    };
    let menu = menu(&app, &labels, &items).map_err(|error| error.to_string())?;
    tray.set_menu(Some(menu))
        .map_err(|error| error.to_string())?;
    tray.set_tooltip(Some(&labels.tooltip))
        .map_err(|error| error.to_string())
}

/// «Salir por completo»: el front ya detuvo los turnos; se para el motor y se sale.
#[tauri::command]
pub(super) async fn quit_completely(app: AppHandle) -> Result<(), String> {
    super::instance::exiting();
    let _ = tauri::async_runtime::spawn_blocking(super::engine::stop).await;
    app.exit(0);
    Ok(())
}

/// Reinicio de la app: la ventana que sale deja de contestar a la que la reemplaza.
#[tauri::command]
pub(super) fn restart_app(app: AppHandle) {
    super::instance::exiting();
    app.restart();
}

/// Aviso del sistema con la ventana oculta o sin foco: una tarea terminó o necesita a la persona.
#[tauri::command]
pub(super) fn tray_notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    // Visible pero detrás de otra app: la barra de tareas parpadea (o rebota el Dock).
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) && !window.is_focused().unwrap_or(true) {
            let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}
