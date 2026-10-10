//! Utilidades exclusivamente de escritorio, sin rutas ni autoridad del dominio.
pub fn ext_of(path: &std::path::Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_lowercase()
}
pub use crate::console::no_console_window;
/// Clave del catálogo que traduce quien la pinta; el guarda `locales` la busca en `Frase::new`.
pub struct Frase(pub &'static str);
impl Frase {
    pub const fn new(clave: &'static str) -> Self {
        Self(clave)
    }
}
