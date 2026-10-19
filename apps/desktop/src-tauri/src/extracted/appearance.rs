//! El fondo del tema con que pintó la ventana, para crear la siguiente ya de ese color.
//! El tema vive en el `localStorage` del webview: Rust solo conoce lo que el front le dice.
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::window::Color;

const FILE: &str = "appearance.json";
static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();

pub(super) fn remember(window_data: &Path) {
    let _ = DIRECTORY.set(window_data.to_path_buf());
}

pub(super) fn background(window_data: &Path) -> Option<Color> {
    let text = std::fs::read_to_string(window_data.join(FILE)).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    parse(value["background"].as_str()?)
}

fn parse(color: &str) -> Option<Color> {
    let hex = color.trim().strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    let n = u32::from_str_radix(hex, 16).ok()?;
    Some(Color((n >> 16) as u8, (n >> 8) as u8, n as u8, 255))
}

#[tauri::command]
pub(super) fn window_background(color: String) {
    let Some(directory) = DIRECTORY.get() else {
        return;
    };
    if parse(&color).is_none() {
        return;
    }
    let path = directory.join(FILE);
    let bytes = serde_json::json!({ "background": color.trim() }).to_string();
    if std::fs::read_to_string(&path).is_ok_and(|current| current == bytes) {
        return;
    }
    if let Err(error) = std::fs::write(&path, bytes) {
        log::warn!("[appearance] {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn only_six_digit_hex_becomes_a_color() {
        let color = parse("#070b1c").map(|c| (c.0, c.1, c.2, c.3));
        assert_eq!(color, Some((7, 11, 28, 255)));
        assert!(parse("oklch(0.2 0 0)").is_none());
        assert!(parse("#fff").is_none());
    }
}
