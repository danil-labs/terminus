//! El abridor pertenece al escritorio; los demás comandos de entorno van al host.
pub fn open_external(target: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let (bin, args): (&str, Vec<&str>) = ("open", vec![]);
    #[cfg(target_os = "windows")]
    let (bin, args): (&str, Vec<&str>) = ("rundll32.exe", vec!["url.dll,FileProtocolHandler"]);
    #[cfg(all(unix, not(target_os = "macos")))]
    let (bin, args): (&str, Vec<&str>) = ("xdg-open", vec![]);
    crate::util::no_console_window(&mut std::process::Command::new(bin))
        .args(args)
        .arg(target)
        .spawn() // proceso largo: a propósito; el escritorio no espera al navegador
        .map(|_| ())
        .map_err(|e| e.to_string())
}
