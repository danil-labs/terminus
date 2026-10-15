//! Actualizar sin cerrar la ventana. En Windows el plugin sale del proceso al
//! instalar; aquí el instalador aparta los `.exe` en uso a `old_*` (`windows/hooks.nsh`).
use tauri_plugin_updater::UpdaterExt;

// El instalador silencioso tarda segundos; uno que no termina no deja la pantalla en «instalando».
#[cfg(windows)]
const INSTALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

#[tauri::command]
pub(super) async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Err("no_update".into());
    };
    // `download` comprueba la firma contra la llave pública de `tauri.conf.json`.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    install(&update, bytes).await
}

#[cfg(windows)]
async fn install(update: &tauri_plugin_updater::Update, bytes: Vec<u8>) -> Result<(), String> {
    let folder = std::env::temp_dir().join(format!("terminus-update-{}", update.version));
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let setup = folder.join(format!("Terminus_{}_x64-setup.exe", update.version));
    std::fs::write(&setup, bytes).map_err(|error| error.to_string())?;
    log::info!("[update] installing {}", update.version);
    // Sin `/R`: el instalador no relanza la app; reiniciar lo decide la persona.
    let status = tauri::async_runtime::spawn_blocking(move || {
        let mut command = std::process::Command::new(&setup);
        crate::util::no_console_window(&mut command).args(["/S", "/UPDATE"]);
        crate::util::output_with_timeout(&mut command, INSTALL_TIMEOUT)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    let _ = std::fs::remove_dir_all(&folder);
    if status.success() {
        Ok(())
    } else {
        Err(format!("installer_exit_{}", status.code().unwrap_or(-1)))
    }
}

/// macOS y Linux reemplazan el bundle o el AppImage sin salir del proceso.
#[cfg(not(windows))]
async fn install(update: &tauri_plugin_updater::Update, bytes: Vec<u8>) -> Result<(), String> {
    update.install(bytes).map_err(|error| error.to_string())
}

/// Hay otra versión instalada sobre esta ventana, desde la app o con el instalador a mano.
#[tauri::command]
pub(super) fn update_pending() -> bool {
    // Desinstalar antes de instalar aparta el ejecutable antes de escribir el nuevo en su ruta.
    super::legacy::set_aside(std::process::id())
        && std::env::current_exe().is_ok_and(|exe| exe.is_file())
}

/// Lo que dejó apartado una instalación anterior; lo que sigue abierto no se deja borrar.
#[cfg(windows)]
pub fn sweep() {
    let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
    else {
        return;
    };
    // La ventana que se reinicia tarda unos segundos en soltar su ejecutable.
    let _ = std::thread::Builder::new()
        .name("sweep".into())
        .spawn(move || {
            for _ in 0..10 {
                if remove_set_aside(&dir) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_secs(3));
            }
        });
}
#[cfg(not(windows))]
pub fn sweep() {}

#[cfg(windows)]
fn remove_set_aside(dir: &std::path::Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return true;
    };
    let mut clean = true;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.starts_with("old_") && name.ends_with(".exe") {
            clean &= std::fs::remove_file(entry.path()).is_ok();
        }
    }
    clean
}
