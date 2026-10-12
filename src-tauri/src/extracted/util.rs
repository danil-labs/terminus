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

/// Espera a `command` hasta `timeout` y lo mata al vencer. No lee su salida: stdout y stderr van a null.
pub fn output_with_timeout(
    command: &mut std::process::Command,
    timeout: std::time::Duration,
) -> std::io::Result<std::process::ExitStatus> {
    use std::process::Stdio;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::ErrorKind::TimedOut.into());
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}
