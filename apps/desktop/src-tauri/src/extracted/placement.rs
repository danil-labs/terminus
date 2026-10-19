//! Dónde y cómo quedó la ventana, para abrirla igual. Vive en la carpeta de datos
//! de la ventana: el laboratorio no hereda la de la app instalada.
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};
use tauri::{PhysicalPosition, PhysicalSize, Runtime, Window, WindowEvent};

const FILE: &str = "placement.json";

/// Posición y tamaño en píxeles físicos, los de la ventana sin maximizar.
#[derive(Serialize, Deserialize, Clone, Copy)]
pub(super) struct Placement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
    fullscreen: bool,
}

/// Lo último visto; se escribe al cerrar, no en cada movimiento.
static LAST: Mutex<Option<Placement>> = Mutex::new(None);

pub(super) fn read(window_data: &Path) -> Option<Placement> {
    let text = std::fs::read_to_string(window_data.join(FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

/// La ventana se crea oculta y se muestra ya en su sitio, sin saltar.
pub(super) fn restore(window: &tauri::WebviewWindow, saved: Placement) {
    *LAST.lock().unwrap_or_else(|p| p.into_inner()) = Some(saved);
    // Con un monitor que ya no está, abre en el tamaño de siempre y no fuera de la vista.
    let monitors = window.available_monitors().unwrap_or_default();
    let reachable = monitors.iter().any(|monitor| {
        let origin = monitor.position();
        let size = monitor.size();
        let (left, top) = (saved.x + 40, saved.y + 20);
        left >= origin.x
            && top >= origin.y
            && left < origin.x + size.width as i32
            && top < origin.y + size.height as i32
    });
    if reachable && saved.width > 0 && saved.height > 0 {
        let _ = window.set_size(PhysicalSize::new(saved.width, saved.height));
        let _ = window.set_position(PhysicalPosition::new(saved.x, saved.y));
    }
    if saved.maximized {
        let _ = window.maximize();
    }
    if saved.fullscreen {
        let _ = window.set_fullscreen(true);
    }
    let _ = window.show();
}

pub(super) fn track<R: Runtime>(window: &Window<R>, event: &WindowEvent, window_data: &Path) {
    if window.label() != "main" {
        return;
    }
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => remember(window),
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => write(window_data),
        _ => {}
    }
}

fn remember<R: Runtime>(window: &Window<R>) {
    // Minimizada u oculta en segundo plano no dice dónde estaba.
    if window.is_minimized().unwrap_or(true) || !window.is_visible().unwrap_or(false) {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let mut last = LAST.lock().unwrap_or_else(|p| p.into_inner());
    let mut next = match *last {
        Some(previous) if maximized || fullscreen => previous,
        _ => {
            let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else {
                return;
            };
            Placement {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                maximized: false,
                fullscreen: false,
            }
        }
    };
    next.maximized = maximized;
    next.fullscreen = fullscreen;
    *last = Some(next);
}

pub(super) fn write(window_data: &Path) {
    let Some(placement) = *LAST.lock().unwrap_or_else(|p| p.into_inner()) else {
        return;
    };
    if let Ok(text) = serde_json::to_string(&placement) {
        let _ = std::fs::write(window_data.join(FILE), text);
    }
}
