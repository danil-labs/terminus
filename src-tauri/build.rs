use std::process::Command;

/// Sella en el binario **de qué commit salió**.
///
/// Con varias mejoras mergeando al día, un reporte de uso que dice «falló algo»
/// sin decir sobre qué build no se puede investigar: el árbol ya se movió. Esto
/// hace que la app pueda contestarlo sola.
///
/// **Y contesta algo que no se puede deducir mirando: qué binario arrancó.** Dos
/// apps con el mismo identificador de bundle no conviven — gana la registrada—, y
/// `open` sobre un `.app` recién compilado arrancó el de `/Applications`. «Probé
/// el build nuevo» puede ser falso sin que nada lo diga, así que el sello es la
/// única comprobación: se lee en Configuración → Estado del entorno.
///
/// Si no hay git —un tarball, un runner sin historia— queda `desconocido` y no
/// se rompe la compilación: es un dato para diagnosticar, no un requisito.
fn sello() {
    let sha = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "desconocido".into());

    // Un árbol sucio produce un binario que no corresponde a ningún commit, y
    // eso hay que verlo en la pantalla, no deducirlo.
    let sucio = Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .ok()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);

    println!(
        "cargo:rustc-env=HARNESS_COMMIT={sha}{}",
        if sucio {
            " (con cambios sin commitear)"
        } else {
            ""
        }
    );

    // Sin esto el sello se queda pegado al primer build: cargo no sabe que el
    // valor depende de algo de fuera del árbol de fuentes.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
}

// tauri_build solo pone el manifiesto en los binarios: sin este, el
// ejecutable de pruebas resuelve comctl32 5.82 sin TaskDialogIndirect y
// muere al cargar. Los dos manifiestos juntos rompen el enlace con CVT1100.
#[cfg(windows)]
fn manifiesto() -> tauri_build::Attributes {
    let ruta = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows.manifest");
    println!("cargo:rerun-if-changed=windows.manifest");
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", ruta.display());
    tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())
}

#[cfg(not(windows))]
fn manifiesto() -> tauri_build::Attributes {
    tauri_build::Attributes::new()
}

fn main() {
    sello();
    tauri_build::try_build(manifiesto()).expect("tauri_build");
}
