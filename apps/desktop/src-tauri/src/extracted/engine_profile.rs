//! `engine.json`: qué motor y qué raíz usa el CLI `terminus` sin ventana. La ventana
//! combina su perfil y deja los de `install.sh` y `remote-host`; también comparte con
//! el CLI el candado de arranque de cada raíz. Ver `docs/engine-client.md`.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions, TryLockError},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime},
};

const VERSION: u64 = 1;
pub const DESKTOP: &str = "desktop";
pub const LAB: &str = "desktop-lab";

/// `%APPDATA%\terminus` en Windows; `$XDG_CONFIG_HOME/terminus` o `~/.config/terminus` en macOS y Linux.
pub fn dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .filter(|base| base.is_absolute())
        .or_else(dirs::config_dir);
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|base| base.is_absolute())
        .or_else(|| dirs::home_dir().map(|home| home.join(".config")));
    base.map(|base| base.join("terminus"))
}

/// La raíz como la comparan la ventana y el CLI, sin el prefijo `\\?\`. Si aún no existe, el
/// antepasado más profundo que existe canonicalizado más el resto, como `normal()` del CLI.
pub fn canonical(path: &Path) -> PathBuf {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut rest = Vec::new();
    let mut current = absolute.as_path();
    loop {
        if let Ok(found) = dunce::canonicalize(current) {
            return rest.iter().rev().fold(found, |acc, part| acc.join(part));
        }
        match (current.parent(), current.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_os_string());
                current = parent;
            }
            _ => return absolute,
        }
    }
}

/// `locks/<sha256 de la raíz canónica en UTF-8>.lock`, el mismo que toma el CLI antes de arrancar.
pub fn start_lock(data: &Path, within: Duration) -> Option<File> {
    let digest = Sha256::digest(canonical(data).to_string_lossy().as_bytes());
    let folder = dir()?.join("locks");
    lock(&folder, &format!("{digest:x}.lock"), within)
}

fn lock(folder: &Path, name: &str, within: Duration) -> Option<File> {
    std::fs::create_dir_all(folder).ok()?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(folder.join(name))
        .ok()?;
    let deadline = Instant::now() + within;
    loop {
        match file.try_lock() {
            Ok(()) => return Some(file),
            Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(_) => {
                log::warn!("[engine] lock {name} not taken");
                return None;
            }
        }
    }
}

/// Cualquier perfil de la misma raíz conserva la autoridad del supervisor.
pub fn managed(data: &Path) -> terminus_engine_protocol::Result<bool> {
    let read = || -> std::io::Result<bool> {
        let Some(folder) = dir() else {
            return Err(std::io::ErrorKind::NotFound.into());
        };
        let bytes = match std::fs::read(folder.join("engine.json")) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        };
        let root: Value = serde_json::from_slice(&bytes)?;
        managed_in(&root, data)
    };
    read().map_err(|_| terminus_engine_protocol::Error::new("managed_profile_invalid"))
}

fn supervised(profile: &Value) -> std::io::Result<bool> {
    let object = profile.as_object().ok_or(std::io::ErrorKind::InvalidData)?;
    for field in ["engine", "sha256", "data_dir", "resource_dir", "identity"] {
        if object
            .get(field)
            .is_some_and(|value| !value.is_null() && !value.is_string())
        {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
    }
    if object
        .get("production")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    match object.get("managed") {
        None | Some(Value::Null) | Some(Value::Bool(false)) => Ok(false),
        Some(Value::Bool(true) | Value::String(_)) => Ok(true),
        _ => Err(std::io::ErrorKind::InvalidData.into()),
    }
}

pub(super) fn managed_in(root: &Value, data: &Path) -> std::io::Result<bool> {
    if root["version"] != VERSION
        || root
            .get("default")
            .is_some_and(|value| !value.is_null() && !value.is_string())
    {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    let profiles = root["profiles"]
        .as_object()
        .ok_or(std::io::ErrorKind::InvalidData)?;
    let data = canonical(data);
    let mut protected = false;
    for profile in profiles.values() {
        let managed = supervised(profile)?;
        let Some(path) = profile["data_dir"].as_str() else {
            if managed {
                return Err(std::io::ErrorKind::InvalidData.into());
            }
            continue;
        };
        if managed && !Path::new(path).is_absolute() {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
        protected |= managed && canonical(Path::new(path)) == data;
    }
    Ok(protected)
}

pub struct Profile<'a> {
    pub name: &'static str,
    pub engine: &'a Path,
    pub data: &'a Path,
    pub resources: &'a Path,
    pub identity: &'a str,
    pub production: bool,
}

/// Escribe el perfil si cambió. La huella se recalcula solo cuando el binario cambia (`mark`).
pub fn publish(profile: &Profile, mark: &Path) -> std::io::Result<bool> {
    let Some(folder) = dir() else {
        return Ok(false);
    };
    if managed(profile.data).map_err(|error| std::io::Error::other(error.code))? {
        return Ok(false);
    }
    let sha256 = fingerprint(profile.engine, mark)?;
    let value = json!({
        "engine": canonical(profile.engine),
        "sha256": sha256,
        "data_dir": canonical(profile.data),
        "resource_dir": canonical(profile.resources),
        "identity": profile.identity,
        "production": profile.production,
        "managed": null,
    });
    std::fs::create_dir_all(&folder)?;
    let _guard = lock(
        &folder.join("locks"),
        "engine.json.lock",
        Duration::from_secs(5),
    );
    let path = folder.join("engine.json");
    let current = std::fs::read(&path).ok();
    let Some(merged) = merge(current.as_deref(), profile.name, value, profile.production) else {
        log::warn!(
            "[engine] {} kept: unknown version or not JSON",
            path.display()
        );
        return Ok(false);
    };
    let unchanged = current
        .as_deref()
        .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
        .is_some_and(|current| current == merged);
    if unchanged {
        return Ok(false);
    }
    write_atomic(&path, &serde_json::to_vec_pretty(&merged)?)?;
    Ok(true)
}

/// El perfil dentro de lo que ya hay; `None` si el archivo es de otra versión o no se entiende.
/// Solo el perfil de producción toma `default`, y solo si falta o nombra un perfil que no existe.
fn merge(
    current: Option<&[u8]>,
    name: &str,
    profile: Value,
    claims_default: bool,
) -> Option<Value> {
    let mut root = match current {
        None => json!({"version": VERSION, "profiles": {}}),
        Some(bytes) => serde_json::from_slice::<Value>(bytes)
            .ok()
            .filter(|root| root["version"] == VERSION)?,
    };
    if root["profiles"].is_null() {
        root["profiles"] = json!({});
    }
    let data = profile["data_dir"]
        .as_str()
        .map(Path::new)
        .unwrap_or(Path::new("."));
    let protected = managed_in(&root, data).ok()?
        || root["profiles"]
            .get(name)
            .map(supervised)
            .transpose()
            .ok()?
            .unwrap_or(false);
    if protected {
        return Some(root);
    }
    let profiles = root["profiles"].as_object_mut()?;
    profiles.insert(name.to_owned(), profile);
    let default_known = root["default"]
        .as_str()
        .is_some_and(|default| root["profiles"].get(default).is_some());
    if claims_default && !default_known {
        root["default"] = json!(name);
    }
    Some(root)
}

fn fingerprint(engine: &Path, mark: &Path) -> std::io::Result<String> {
    let meta = std::fs::metadata(engine)?;
    let nanos = |time: std::io::Result<SystemTime>| {
        time.ok()
            .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|elapsed| elapsed.as_nanos().to_string())
    };
    let stamp = json!({
        "engine": engine,
        "len": meta.len(),
        "modified": nanos(meta.modified()),
        "created": nanos(meta.created()),
    });
    let saved = std::fs::read(mark)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    if let Some(saved) = saved.filter(|saved| saved["stamp"] == stamp) {
        if let Some(sha256) = saved["sha256"].as_str() {
            return Ok(sha256.to_owned());
        }
    }
    let mut hasher = Sha256::new();
    std::io::copy(&mut File::open(engine)?, &mut hasher)?;
    let sha256 = format!("{:x}", hasher.finalize());
    let saved = json!({"stamp": stamp, "sha256": sha256});
    if let Err(error) = write_atomic(mark, &serde_json::to_vec(&saved)?) {
        log::warn!("[engine] engine mark not saved: {error}");
    }
    Ok(sha256)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&temporary, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temporary);
    })
}

#[cfg(test)]
mod tests {
    use super::{canonical, managed_in, merge};
    use serde_json::{json, Value};

    #[test]
    fn a_root_that_does_not_exist_yet_hashes_like_the_cli() {
        let folder = tempfile::tempdir().unwrap();
        let real = dunce::canonicalize(folder.path()).unwrap();
        let missing = folder.path().join("ai.danil.terminus").join("engine");
        assert_eq!(
            canonical(&missing),
            real.join("ai.danil.terminus").join("engine")
        );
        if cfg!(windows) {
            let spelled = folder.path().to_string_lossy().to_uppercase();
            let spelled = std::path::PathBuf::from(spelled).join("ai.danil.terminus");
            assert_eq!(canonical(&spelled), real.join("ai.danil.terminus"));
        }
    }

    #[test]
    fn a_managed_alias_protects_the_root_and_the_published_profile() {
        let folder = tempfile::tempdir().unwrap();
        let data = folder.path().join("engine");
        std::fs::create_dir(&data).unwrap();
        let root = json!({"version":1,"default":"other","profiles": {
            "other": {"data_dir": folder.path().join("other"), "managed": null},
            "service": {"data_dir": data.join("."), "managed": "supervisor start", "future": 42},
            "desktop": {"data_dir": data, "managed": null}
        }});
        assert!(managed_in(&root, &data).unwrap());
        assert!(!managed_in(&root, &folder.path().join("other")).unwrap());
        let bytes = serde_json::to_vec(&root).unwrap();
        assert_eq!(
            merge(Some(&bytes), "desktop", json!({"data_dir":data}), true),
            Some(root)
        );
        assert!(managed_in(&json!({"version":2,"profiles":{}}), &data).is_err());
        assert!(managed_in(&json!({"version":1,"profiles":null}), &data).is_err());
        assert!(managed_in(
            &json!({"version":1,"profiles":{"host":{"managed":"service start"}}}),
            &data
        )
        .is_err());
        assert!(managed_in(&json!({"version":1,"profiles":{"host":{"data_dir":"relative","managed":"service start"}}}), &data).is_err());
    }

    #[test]
    fn malformed_profiles_fail_closed_and_false_matches_the_cli() {
        let folder = tempfile::tempdir().unwrap();
        let data = folder.path();
        for invalid in [
            json!([]),
            json!(null),
            json!({"managed": []}),
            json!({"data_dir": 42}),
            json!({"production": null}),
        ] {
            let root = json!({"version":1,"profiles":{"bad":invalid,"service":{"data_dir":data,"managed":true}}});
            assert!(managed_in(&root, data).is_err());
            assert!(merge(
                Some(&serde_json::to_vec(&root).unwrap()),
                "desktop",
                json!({"data_dir":data}),
                true
            )
            .is_none());
        }
        for policy in [Value::Null, json!(false)] {
            let root = json!({"version":1,"profiles":{"desktop":{"data_dir":data,"managed":policy,"future":42}}});
            assert!(!managed_in(&root, data).unwrap());
            let merged = merge(
                Some(&serde_json::to_vec(&root).unwrap()),
                "desktop",
                json!({"data_dir":data,"managed":null}),
                true,
            )
            .unwrap();
            assert_eq!(merged["profiles"]["desktop"]["managed"], Value::Null);
        }
        for policy in [json!(true), json!("service start")] {
            assert!(managed_in(
                &json!({"version":1,"profiles":{"host":{"data_dir":data,"managed":policy}}}),
                data
            )
            .unwrap());
        }
    }

    #[test]
    fn the_window_keeps_other_profiles_and_only_production_takes_default() {
        let host = serde_json::to_vec(&json!({"version":1,"default":"host","profiles":{"host":{"data_dir": std::env::temp_dir().join("seldon-host"),"managed":"systemctl --user start seldon-host"}},"extra":true})).unwrap();
        let merged = merge(
            Some(&host),
            "desktop",
            json!({"identity": "ai.danil.terminus"}),
            true,
        )
        .unwrap();
        assert_eq!(merged["default"], "host");
        assert_eq!(merged["extra"], true);
        assert_eq!(
            merged["profiles"]["host"]["managed"],
            "systemctl --user start seldon-host"
        );
        assert_eq!(
            merged["profiles"]["desktop"]["identity"],
            "ai.danil.terminus"
        );

        let fresh = merge(None, "desktop", json!({}), true).unwrap();
        assert_eq!(
            fresh,
            json!({"version": 1, "default": "desktop", "profiles": {"desktop": {}}})
        );
        let lab = merge(None, "desktop-lab", json!({}), false).unwrap();
        assert!(lab.get("default").is_none());
        let orphan = br#"{"version":1,"default":"gone","profiles":{}}"#;
        assert_eq!(
            merge(Some(orphan), "desktop", json!({}), true).unwrap()["default"],
            "desktop"
        );

        assert!(merge(
            Some(br#"{"version":2,"profiles":{}}"#),
            "desktop",
            json!({}),
            true
        )
        .is_none());
        assert!(merge(Some(b"{not json"), "desktop", json!({}), true).is_none());
        assert!(merge(
            Some(br#"{"version":1,"profiles":[]}"#),
            "desktop",
            json!({}),
            true
        )
        .is_none());
    }
}
