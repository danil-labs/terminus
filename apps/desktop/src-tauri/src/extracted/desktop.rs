//! Acciones de escritorio originales de harness-app 96dba061, Apache-2.0.
use tauri::{Emitter, Manager};
#[tauri::command]
pub(super) fn request_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

/// Cerrar conserva el cliente y sus turnos, incluso durante el arranque.
pub(super) fn on_close_requested(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    if window.label() != "main" {
        return;
    }
    api.prevent_close();
    if let Err(error) = super::tray::hide_window(window.app_handle()) {
        log::warn!("[tray] close kept visible: {error}");
        let _ = window.emit("close-requested", ());
    }
}

/// La salida nativa y la del icono pasan por la misma confirmación.
pub(super) fn request_quit(app: &tauri::AppHandle) {
    if !super::tray::FRONT_READY.load(std::sync::atomic::Ordering::SeqCst)
        || app
            .try_state::<std::sync::Arc<super::proxy::State>>()
            .is_none()
    {
        app.exit(0);
        return;
    }
    super::tray::show_window(app);
    let _ = app.emit("tray-quit", ());
}

pub(super) static STARTED: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

#[tauri::command]
pub(super) fn window_ready(at: u64) {
    let proceso = STARTED
        .get()
        .map(|t| t.elapsed().as_millis() as u64)
        .unwrap_or_default();
    log::warn!("[tiempo] startup — {proceso} ms");
    log::warn!("[tiempo] startup_document — {at} ms");
}

/// El sidebar ya enseña tareas: de la caché de la ventana anterior o del motor.
#[tauri::command]
pub(super) fn window_painted(at: u64, source: String) {
    let proceso = STARTED
        .get()
        .map(|t| t.elapsed().as_millis() as u64)
        .unwrap_or_default();
    log::warn!("[tiempo] sidebar_{source} — {proceso} ms (documento {at} ms)");
}

#[tauri::command]
pub(super) fn window_vitals(
    webview: tauri::Webview,
    nodes: u64,
    heap_mb: u64,
    tabs: u64,
    threads: u64,
    messages: u64,
) {
    log::warn!(
        "[webview] nodos={nodes} heap={heap_mb} MB pestanas={tabs} hilos={threads} mensajes={messages}"
    );
    #[cfg(target_os = "macos")]
    let _ = webview.with_webview(|platform| {
        use objc2::runtime::AnyObject;
        use objc2::{msg_send, sel};
        let view = platform.inner().cast::<AnyObject>();
        unsafe {
            let responds: bool = msg_send![&*view, respondsToSelector: sel!(_webProcessIdentifier)];
            if responds {
                let pid: libc::pid_t = msg_send![&*view, _webProcessIdentifier];
                log::info!("[webview] pid={pid}");
            }
        }
    });
    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
    }
}

#[cfg(target_os = "macos")]
pub(super) fn configure_close_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, WINDOW_SUBMENU_ID};
    use tauri::Manager;

    let menu = Menu::default(app.handle())?;
    let close_text = PredefinedMenuItem::close_window(app, None)?.text()?;
    for item in menu.items()? {
        let MenuItemKind::Submenu(submenu) = item else {
            continue;
        };
        for (index, item) in submenu.items()?.into_iter().enumerate() {
            let MenuItemKind::Predefined(predefined) = &item else {
                continue;
            };
            if predefined.text()? != close_text {
                continue;
            }
            let (id, shortcut) = if submenu.id().as_ref() == WINDOW_SUBMENU_ID {
                ("close-window", "CmdOrCtrl+Shift+W")
            } else {
                ("close-tab", "CmdOrCtrl+W")
            };
            let replacement = MenuItem::with_id(app, id, &close_text, true, Some(shortcut))?;
            submenu.remove(&item)?;
            submenu.insert(&replacement, index)?;
        }
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let Some(window) = app.get_window("main") else {
            return;
        };
        match event.id().as_ref() {
            "close-tab" => {
                let _ = window.emit("close-tab", ());
            }
            "close-window" => {
                let _ = request_close(window);
            }
            _ => {}
        }
    });
    Ok(())
}
