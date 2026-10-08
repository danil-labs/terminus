//! Acciones de escritorio originales de harness-app 96dba061, Apache-2.0.

use serde::Serialize;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

#[cfg(target_os = "linux")]
mod linux_layer {
    use gtk::glib::translate::ToGlibPtr;
    use gtk::prelude::*;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::Webview;

    unsafe extern "C" fn child_position(
        _overlay: *mut gtk::ffi::GtkOverlay,
        view: *mut gtk::ffi::GtkWidget,
        allocation: *mut gtk::ffi::GtkAllocation,
        _data: *mut std::ffi::c_void,
    ) -> gtk::glib::ffi::gboolean {
        if view.is_null() || allocation.is_null() {
            return 0;
        }
        let (mut width, mut height) = (0, 0);
        unsafe { gtk::ffi::gtk_widget_get_size_request(view, &mut width, &mut height) };
        if width < 1 || height < 1 {
            return 0;
        }
        unsafe {
            let x = gtk::ffi::gtk_widget_get_margin_start(view);
            let y = gtk::ffi::gtk_widget_get_margin_top(view);
            (*allocation).x = 0;
            (*allocation).y = 0;
            (*allocation).width = width.saturating_add(x);
            (*allocation).height = height.saturating_add(y);
        }
        1
    }

    fn fixed_overlay_position(overlay: &gtk::Overlay) {
        let overlay_ptr: *mut gtk::ffi::GtkOverlay = overlay.to_glib_none().0;
        unsafe {
            gtk::glib::gobject_ffi::g_signal_connect_data(
                overlay_ptr as *mut gtk::glib::gobject_ffi::GObject,
                c"get-child-position".as_ptr(),
                Some(std::mem::transmute::<
                    unsafe extern "C" fn(
                        *mut gtk::ffi::GtkOverlay,
                        *mut gtk::ffi::GtkWidget,
                        *mut gtk::ffi::GtkAllocation,
                        *mut std::ffi::c_void,
                    ) -> gtk::glib::ffi::gboolean,
                    unsafe extern "C" fn(),
                >(child_position)),
                std::ptr::null_mut(),
                None,
                gtk::glib::gobject_ffi::G_CONNECT_DEFAULT,
            );
        }
    }

    fn position(view: &gtk::Widget, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
        let overlay = view
            .parent()
            .and_then(|parent| parent.downcast::<gtk::Overlay>().ok())
            .ok_or("El sitio no está en la capa GTK")?;
        let x = x.round() as i32;
        let y = y.round() as i32;
        let width = width.max(1.0).round() as i32;
        let height = height.max(1.0).round() as i32;
        view.set_margin_start(x);
        view.set_margin_top(y);
        view.set_size_request(width, height);
        overlay.queue_resize();
        Ok(())
    }

    fn mount(view: &gtk::Widget, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
        let box_ = view
            .parent()
            .and_then(|parent| parent.downcast::<gtk::Box>().ok())
            .ok_or("El sitio no está en el contenedor GTK")?;
        let overlay = if let Some(overlay) = box_
            .parent()
            .and_then(|parent| parent.downcast::<gtk::Overlay>().ok())
        {
            overlay
        } else {
            let window = box_
                .parent()
                .and_then(|parent| parent.downcast::<gtk::Window>().ok())
                .ok_or("Falta la ventana GTK")?;
            let overlay = gtk::Overlay::new();
            window.remove(&box_);
            overlay.add(&box_);
            fixed_overlay_position(&overlay);
            window.add(&overlay);
            overlay.show();
            overlay
        };
        box_.remove(view);
        view.set_halign(gtk::Align::Start);
        view.set_valign(gtk::Align::Start);
        overlay.add_overlay(view);
        position(view, x, y, width, height)
    }

    fn on_main(
        webview: &Webview,
        operation: impl FnOnce(&gtk::Widget) -> Result<(), String> + Send + 'static,
    ) -> Result<(), String> {
        let (tx, rx) = mpsc::channel();
        webview
            .with_webview(move |platform| {
                let view = platform.inner().upcast::<gtk::Widget>();
                let _ = tx.send(operation(&view));
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?
    }

    pub fn attach(
        webview: &Webview,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(), String> {
        on_main(webview, move |view| mount(view, x, y, width, height))
    }

    pub fn place(webview: &Webview, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
        on_main(webview, move |view| position(view, x, y, width, height))
    }
}

const VENTANA: &str = "main";

const PLAZO: Duration = Duration::from_secs(3);

static CUENTA: AtomicU32 = AtomicU32::new(0);

#[derive(Serialize)]
pub struct Sitio {
    label: String,
    url: String,
}

#[derive(Clone, Serialize)]
struct Estado {
    label: String,
    estado: &'static str,
    url: String,
}

pub fn abrible(v: &str) -> Result<String, String> {
    let u = Url::parse(v).map_err(|_| format!("«{v}» no es una dirección"))?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err(format!(
            "«{}» no es una dirección web que se pueda abrir aquí",
            u.scheme()
        ));
    }
    if u.host_str().unwrap_or_default().is_empty() {
        return Err(format!("«{v}» no dice a qué servidor ir"));
    }
    Ok(u.to_string())
}

pub fn abrible_fuera(v: &str) -> Result<String, String> {
    let u = Url::parse(v).map_err(|_| format!("«{v}» no es una dirección"))?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err(format!(
            "«{}» no es una dirección que se pueda abrir en tu navegador",
            u.scheme()
        ));
    }
    if u.host_str().unwrap_or_default().is_empty() {
        return Err(format!("«{v}» no dice a qué servidor ir"));
    }
    Ok(u.to_string())
}

#[tauri::command]
pub fn site_open_external(url: String) -> Result<(), String> {
    crate::env::open_external(abrible_fuera(&url)?)
}

fn responde(url: &str) -> Result<(), String> {
    let config = ureq::Agent::config_builder()
        .timeout_global(Some(PLAZO))
        .timeout_connect(Some(PLAZO))
        .http_status_as_error(false)
        .build();
    let agent: ureq::Agent = config.into();
    match agent.get(url).call() {
        Ok(_) => Ok(()),
        Err(ureq::Error::Timeout(_)) => Err(format!(
            "{url} no contestó en {} s. El servidor sigue arriba pero no responde.",
            PLAZO.as_secs()
        )),
        Err(_) => Err(format!(
            "No se pudo llegar a {url}. Si lo levantó una tarea, puede que su turno ya haya \
             terminado; si está fuera de esta computadora, comprueba tu conexión."
        )),
    }
}

#[tauri::command]
pub fn site_sweep(app: tauri::AppHandle) -> Result<(), String> {
    for (label, w) in app.webviews() {
        if label.starts_with("sitio-") {
            let _ = w.close();
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn site_open(
    app: tauri::AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<Sitio, String> {
    let url = abrible(&url)?;
    responde(&url)?;

    let ventana = app
        .get_window(VENTANA)
        .ok_or("La ventana principal no está")?;
    let label = format!("sitio-{}", CUENTA.fetch_add(1, Ordering::Relaxed));
    let destino = Url::parse(&url).map_err(|e| e.to_string())?;

    let app_nav = app.clone();
    let app_load = app.clone();
    let label_load = label.clone();

    let constructor = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(destino))
        .incognito(true)
        .disable_drag_drop_handler()
        .on_navigation(move |u| abrible(u.as_str()).is_ok())
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .on_page_load(move |_, carga| {
            let estado = match carga.event() {
                tauri::webview::PageLoadEvent::Started => "cargando",
                tauri::webview::PageLoadEvent::Finished => "listo",
            };
            let _ = app_load.emit(
                "site",
                Estado {
                    label: label_load.clone(),
                    estado,
                    url: carga.url().to_string(),
                },
            );
        });

    ventana
        .add_child(
            constructor,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|e| format!("No se pudo abrir el sitio: {e}"))?;

    if let Some(w) = app_nav.get_webview(&label) {
        w.hide().map_err(|e| e.to_string())?;
        #[cfg(target_os = "linux")]
        linux_layer::attach(&w, x, y, width, height)?;
    }

    Ok(Sitio { label, url })
}

#[tauri::command(async)]
pub fn site_place(
    app: tauri::AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let w = app
        .get_webview(&label)
        .ok_or("Ese sitio ya no está abierto")?;
    #[cfg(target_os = "linux")]
    linux_layer::place(&w, x, y, width, height)?;
    #[cfg(not(target_os = "linux"))]
    w.set_bounds(tauri::Rect {
        position: LogicalPosition::new(x, y).into(),
        size: LogicalSize::new(width.max(1.0), height.max(1.0)).into(),
    })
    .map_err(|e| e.to_string())?;
    w.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn site_hide(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(w) = app.get_webview(&label) {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn site_close(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(w) = app.get_webview(&label) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn site_go(app: tauri::AppHandle, label: String, delta: i32) -> Result<(), String> {
    let w = app.get_webview(&label).ok_or("Esa pestaña ya no está")?;
    let paso = delta.clamp(-1, 1);
    w.eval(format!("history.go({paso})"))
        .map_err(|e| format!("No se pudo navegar: {e}"))
}

#[tauri::command]
pub fn site_navigate(app: tauri::AppHandle, label: String, url: String) -> Result<(), String> {
    let w = app
        .get_webview(&label)
        .ok_or("Ese sitio ya no está abierto")?;
    let destino = Url::parse(&abrible(&url)?).map_err(|e| e.to_string())?;
    w.navigate(destino)
        .map_err(|e| format!("No se pudo navegar: {e}"))
}

#[tauri::command]
pub fn site_reload(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let w = app
        .get_webview(&label)
        .ok_or("Ese sitio ya no está abierto")?;
    w.reload().map_err(|e| e.to_string())
}
