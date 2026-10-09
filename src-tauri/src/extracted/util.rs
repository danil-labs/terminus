//! Utilidades exclusivamente de escritorio, sin rutas ni autoridad del dominio.
pub fn ext_of(path: &std::path::Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_lowercase()
}
pub fn no_console_window(command: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
/// Clave del catálogo que traduce quien la pinta; el guarda `locales` la busca en `Frase::new`.
pub struct Frase(pub &'static str);
impl Frase {
    pub const fn new(clave: &'static str) -> Self {
        Self(clave)
    }
}
