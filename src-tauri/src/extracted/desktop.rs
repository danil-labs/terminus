//! Acciones de escritorio originales de harness-app 96dba061, Apache-2.0.
use tauri::{Emitter, Manager};
#[tauri::command]
pub(super) fn request_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

static CLOSE_CONFIRMED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static CLOSE_ASKED: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

/// El front ya decidió qué hacer con los turnos vivos; ahora sí se cierra.
#[tauri::command]
pub(super) fn close_confirmed(window: tauri::Window) -> Result<(), String> {
    CLOSE_CONFIRMED.store(true, std::sync::atomic::Ordering::SeqCst);
    window.close().map_err(|error| error.to_string())
}

/// Todo cierre de la ventana (X, Alt+F4, barra de tareas, menú) pregunta antes
/// al front si hay agentes trabajando. Un segundo intento seguido cierra igual:
/// un front colgado no puede dejar la ventana imposible de cerrar.
pub(super) fn on_close_requested(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    use std::sync::atomic::Ordering;
    if CLOSE_CONFIRMED.load(Ordering::SeqCst) {
        return;
    }
    // Sin motor (traspaso o arranque fallido) no hay turnos que cuidar.
    if window
        .app_handle()
        .try_state::<std::sync::Arc<super::proxy::State>>()
        .is_none()
    {
        return;
    }
    let now = std::time::Instant::now();
    let mut asked = CLOSE_ASKED.lock().unwrap_or_else(|p| p.into_inner());
    if asked.is_some_and(|at| now.duration_since(at) < std::time::Duration::from_secs(4)) {
        return;
    }
    *asked = Some(now);
    api.prevent_close();
    let _ = window.emit("close-requested", ());
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
