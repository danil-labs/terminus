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

/// `get_window`: con Typst o un sitio abiertos la ventana tiene varias vistas y
/// `get_webview_window` ya no la devuelve.
pub(super) fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
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
    if let Some(window) = app.get_window("main") {
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

/// Una tarea terminó o necesita a la persona. Con la ventana fuera de la pantalla
/// sale un aviso del sistema; a la vista solo parpadea, y solo si la necesita. Con
/// foco responde `focused` y el aviso lo pinta la ventana.
#[tauri::command]
pub(super) fn tray_notify(
    app: AppHandle,
    title: String,
    body: String,
    needs_you: bool,
    key: String,
) -> Result<&'static str, String> {
    #[cfg(not(windows))]
    use tauri_plugin_notification::NotificationExt;
    // El foco lo dice la ventana nativa: el del documento no ve el de las vistas hijas.
    if let Some(window) = app.get_window("main") {
        let on_screen =
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
        let focused = in_front(&window);
        log::info!("[aviso] needs_you={needs_you} on_screen={on_screen} focused={focused}");
        if on_screen && focused {
            return Ok("focused");
        }
        if on_screen {
            if needs_you {
                let _ =
                    window.request_user_attention(Some(tauri::UserAttentionType::Informational));
                return Ok("flash");
            }
            return Ok("none");
        }
    }
    #[cfg(windows)]
    {
        windows_toast(&app, &title, &body, &key);
        Ok("system")
    }
    #[cfg(not(windows))]
    {
        // Fuera de Windows el plugin no avisa del clic.
        let _ = key;
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map(|()| "system")
            .map_err(|error| error.to_string())
    }
}

/// En Windows `is_focused` dice que no cuando el foco está dentro del WebView2;
/// la ventana del frente sí lo sabe.
fn in_front(window: &tauri::Window) -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetForegroundWindow, GA_ROOT,
        };
        if let Ok(hwnd) = window.hwnd() {
            let front = unsafe { GetAncestor(GetForegroundWindow(), GA_ROOT) };
            return !front.is_null() && front == hwnd.0;
        }
    }
    window.is_focused().unwrap_or(false)
}

/// Esquema con el que Windows abre `terminus.exe` al pulsar un aviso, aunque ya
/// esté en el centro de notificaciones; la ventana abierta recibe la tarea.
pub(super) const NOTICE_SCHEME: &str = "terminus-notice";

/// La clave del aviso en `terminus-notice://open?key=<espacio>/<tarea>`.
pub(super) fn notice_key(arg: &std::ffi::OsStr) -> Option<String> {
    let key = arg
        .to_str()?
        .strip_prefix(NOTICE_SCHEME)?
        .strip_prefix("://open?key=")?
        .trim_end_matches('/');
    let valid = !key.is_empty()
        && key.len() <= 200
        && key.chars().all(|c| c.is_ascii_alphanumeric() || "-_/".contains(c));
    valid.then(|| key.to_owned())
}

#[cfg(windows)]
fn installed() -> bool {
    tauri::utils::platform::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
        .is_some_and(|dir| !dir.ends_with("target/debug") && !dir.ends_with("target/release"))
}

/// Solo la copia instalada: una de desarrollo no se queda con los enlaces.
#[cfg(windows)]
pub(super) fn register_notice_scheme() {
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    if !installed() {
        return;
    }
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let set = |key: &str, name: Option<&str>, value: &str| {
        let (key, value) = (wide(key), wide(value));
        let name = name.map(wide);
        let name = name.as_ref().map_or(std::ptr::null(), |name| name.as_ptr());
        let size = (value.len() * 2) as u32;
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name,
                REG_SZ,
                value.as_ptr().cast(),
                size,
            )
        };
    };
    let base = format!(r"Software\Classes\{NOTICE_SCHEME}");
    set(&base, None, "URL:Terminus");
    set(&base, Some("URL Protocol"), "");
    let command = format!("\"{}\" \"%1\"", exe.display());
    set(&format!(r"{base}\shell\open\command"), None, &command);
}

#[cfg(windows)]
fn windows_toast(app: &AppHandle, title: &str, body: &str, key: &str) {
    let escape = |text: &str| {
        text.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    // Sin instalar no hay AppUserModelID ni esquema registrados: avisa sin abrir nada.
    let (app_id, launch) = if installed() {
        let link = format!("{NOTICE_SCHEME}://open?key={key}");
        let launch = format!(r#" activationType="protocol" launch="{}""#, escape(&link));
        (app.config().identifier.clone(), launch)
    } else {
        (POWERSHELL_APP_ID.to_owned(), String::new())
    };
    let xml = format!(
        r#"<toast{launch}><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual></toast>"#,
        escape(title),
        escape(body)
    );
    // Como el plugin: WinRT fuera del hilo de la ventana, que no publica el aviso.
    std::thread::spawn(move || match show_toast(&app_id, &xml) {
        Ok(()) => log::info!("[aviso] mostrado app_id={app_id}"),
        Err(error) => log::warn!("[aviso] no se pudo mostrar app_id={app_id}: {error}"),
    });
}

#[cfg(windows)]
const POWERSHELL_APP_ID: &str =
    "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

#[cfg(windows)]
fn show_toast(app_id: &str, xml: &str) -> windows::core::Result<()> {
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
    };
    let document = XmlDocument::new()?;
    document.LoadXml(&HSTRING::from(xml))?;
    let toast = ToastNotification::CreateToastNotification(&document)?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)
}
