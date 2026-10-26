//! Terminus abierto desde el disco del .dmg (o trasladado por Gatekeeper) no se
//! actualiza y desaparece al expulsarlo: antes de lanzar el motor ofrece copiarlo
//! a Aplicaciones, lo abre desde ahí y expulsa el disco al salir.
use super::util::Frase;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

const ES: &str = include_str!("../../../src/locales/es/shell.json");
const EN: &str = include_str!("../../../src/locales/en/shell.json");
const APPLICATIONS: &str = "/Applications";

/// `true` si esta copia ya abrió la de Aplicaciones y tiene que salir.
pub fn offer() -> bool {
    let Some(bundle) = std::env::current_exe().ok().and_then(|exe| bundle_of(&exe)) else {
        return false;
    };
    if !outside_applications(&bundle) {
        return false;
    }
    let catalog: Value = serde_json::from_str(if spanish() { ES } else { EN }).unwrap_or_default();
    let phrase = |frase: Frase| catalog[frase.0].as_str().unwrap_or(frase.0).to_owned();
    let move_label = phrase(Frase::new("shell.relocate.move"));
    let answer = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Info)
        .set_title(phrase(Frase::new("shell.relocate.title")))
        .set_description(phrase(Frase::new("shell.relocate.body")))
        .set_buttons(rfd::MessageButtons::OkCancelCustom(
            move_label.clone(),
            phrase(Frase::new("shell.relocate.later")),
        ))
        .show();
    let accepted = match answer {
        rfd::MessageDialogResult::Ok => true,
        rfd::MessageDialogResult::Custom(label) => label == move_label,
        _ => false,
    };
    if !accepted {
        return false;
    }
    let lab = std::env::var_os("TERMINUS_LAB_ROOT").filter(|root| !root.is_empty());
    // El laboratorio copia a su propia carpeta: nunca reemplaza el Terminus instalado.
    let applications = lab.as_ref().map_or(PathBuf::from(APPLICATIONS), |root| {
        Path::new(root).join("Applications")
    });
    let target = applications.join(bundle.file_name().unwrap_or_default());
    if let Err(error) = install(&bundle, &target) {
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Warning)
            .set_title(phrase(Frase::new("shell.relocate.title")))
            .set_description(
                phrase(Frase::new("shell.relocate.failed")).replace("{error}", &error.to_string()),
            )
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        return false;
    }
    if Command::new("/usr/bin/open")
        .arg("-n")
        .arg(&target)
        .status()
        .map_or(true, |s| !s.success())
    {
        return false;
    }
    if let Some(volume) = volume_of(&bundle) {
        eject_after_exit(&volume);
    }
    true
}

/// El `.app` que contiene al ejecutable: `…/Terminus.app/Contents/MacOS/terminus`.
fn bundle_of(exe: &Path) -> Option<PathBuf> {
    exe.ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .map(Path::to_path_buf)
}

fn outside_applications(bundle: &Path) -> bool {
    bundle.starts_with("/Volumes")
        || bundle
            .components()
            .any(|part| part.as_os_str() == "AppTranslocation")
}

/// `/Volumes/<disco>` del bundle; un traslado de Gatekeeper no tiene disco que expulsar.
fn volume_of(bundle: &Path) -> Option<PathBuf> {
    let mut parts = bundle.components();
    let (_, volumes, name) = (parts.next()?, parts.next()?, parts.next()?);
    (volumes.as_os_str() == "Volumes").then(|| Path::new("/Volumes").join(name))
}

/// `ditto` conserva la firma y los atributos; la copia anterior se aparta y se borra al final.
fn install(source: &Path, target: &Path) -> std::io::Result<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let aside = target.with_extension("app.old");
    let _ = std::fs::remove_dir_all(&aside);
    let had_previous = target.exists();
    if had_previous {
        std::fs::rename(target, &aside)?;
    }
    let copied = Command::new("/usr/bin/ditto")
        .arg(source)
        .arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()?;
    if !copied.status.success() {
        let _ = std::fs::remove_dir_all(target);
        if had_previous {
            let _ = std::fs::rename(&aside, target);
        }
        return Err(std::io::Error::other(
            String::from_utf8_lossy(&copied.stderr).trim().to_owned(),
        ));
    }
    let _ = std::fs::remove_dir_all(&aside);
    Ok(())
}

/// El disco no se expulsa mientras esta copia corre desde él: un `sh` aparte espera a que salga.
fn eject_after_exit(volume: &Path) {
    let script = r#"while kill -0 "$1" 2>/dev/null; do sleep 0.5; done; /usr/bin/hdiutil detach "$2" -quiet"#;
    let _ = Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .arg("sh")
        .arg(std::process::id().to_string())
        .arg(volume)
        .current_dir("/")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

/// La primera lengua de las preferencias del sistema; una app abierta desde Finder no trae `LANG`.
fn spanish() -> bool {
    Command::new("/usr/bin/defaults")
        .args(["read", "-g", "AppleLanguages"])
        .stderr(Stdio::null())
        .output()
        .ok()
        .and_then(|out| {
            String::from_utf8_lossy(&out.stdout)
                .split(['(', ',', '\n'])
                .map(|item| item.trim().trim_matches('"').to_owned())
                .find(|item| !item.is_empty())
        })
        .is_some_and(|first| first.starts_with("es"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_disk_or_a_translocation_is_outside_applications() {
        let disk = Path::new("/Volumes/Instalar Terminus/Terminus.app");
        let moved = Path::new("/private/var/folders/x/AppTranslocation/ABC/d/Terminus.app");
        assert!(outside_applications(disk));
        assert!(outside_applications(moved));
        assert!(!outside_applications(Path::new(
            "/Applications/Terminus.app"
        )));
        assert!(!outside_applications(Path::new(
            "/Users/a/Applications/Terminus.app"
        )));
        assert_eq!(
            volume_of(disk),
            Some(PathBuf::from("/Volumes/Instalar Terminus"))
        );
        assert_eq!(volume_of(moved), None);
    }

    #[test]
    fn the_bundle_is_the_app_around_the_executable() {
        let exe = Path::new("/Volumes/Instalar Terminus/Terminus.app/Contents/MacOS/terminus");
        assert_eq!(
            bundle_of(exe),
            Some(PathBuf::from("/Volumes/Instalar Terminus/Terminus.app"))
        );
        assert_eq!(bundle_of(Path::new("/usr/local/bin/terminus")), None);
    }
}
