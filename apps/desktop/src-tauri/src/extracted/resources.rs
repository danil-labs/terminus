//! La copia de recursos de un AppImage, una por versión, según el inventario del build.
//!
//! `resources-inventory.json` lista cada archivo y symlink de los recursos; su sha256 es
//! la clave de la copia. Los bytes se verifican una sola vez, al copiar, y la marca
//! `ready` cierra la copia: los arranques siguientes solo leen esa marca. El motor toma un
//! candado compartido sobre `<copia>/ready`; solo se borran copias sin ese candado.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

pub(super) const INVENTORY: &str = "resources-inventory.json";
const READY: &str = "ready";
const SELECTION: &str = "selection.json";

#[derive(Deserialize)]
struct Inventory {
    files: Vec<FileRow>,
    symlinks: Vec<LinkRow>,
}

#[derive(Deserialize)]
struct FileRow {
    path: String,
    size: u64,
    sha256: String,
    mode: u32,
}

#[derive(Deserialize)]
struct LinkRow {
    path: String,
    target: String,
}

#[derive(Default, serde::Serialize, Deserialize)]
struct Selection {
    current: Option<String>,
    previous: Option<String>,
}

fn invalid(reason: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, reason)
}

fn private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Una ruta del inventario: relativa, con `/`, sin `.` ni `..`.
fn relative(value: &str) -> io::Result<PathBuf> {
    let path = Path::new(value);
    if value.is_empty() || value.contains('\\') || value.contains(':') {
        return Err(invalid("resource_path"));
    }
    if !path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(invalid("resource_path"));
    }
    Ok(path.to_path_buf())
}

/// El destino de un symlink, resuelto sin tocar el disco, tiene que quedar dentro de la copia.
fn link_inside(path: &Path, target: &str) -> io::Result<()> {
    if target.is_empty() || target.starts_with('/') || target.contains('\\') {
        return Err(invalid("resource_link"));
    }
    let mut depth: Vec<_> = path
        .parent()
        .into_iter()
        .flat_map(|p| p.components())
        .collect();
    for part in Path::new(target).components() {
        match part {
            Component::Normal(_) => depth.push(part),
            Component::CurDir => {}
            Component::ParentDir if depth.pop().is_some() => {}
            _ => return Err(invalid("resource_link")),
        }
    }
    Ok(())
}

fn copy_verified(source: &Path, target: &Path, row: &FileRow) -> io::Result<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    if !fs::symlink_metadata(source)?.is_file() {
        return Err(invalid("resource_not_regular"));
    }
    let mut input = File::open(source)?;
    let mut output = File::options().write(true).create_new(true).open(target)?;
    let mut hash = Sha256::new();
    let mut length = 0u64;
    let mut buffer = vec![0; 1 << 16];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
        output.write_all(&buffer[..count])?;
        length += count as u64;
    }
    if length != row.size || format!("{:x}", hash.finalize()) != row.sha256 {
        return Err(invalid("resource_copy_changed"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if row.mode & 0o111 != 0 { 0o755 } else { 0o644 };
        output.set_permissions(fs::Permissions::from_mode(mode))?;
    }
    Ok(())
}

/// Un `syncfs` antes de la marca vale por un `fsync` de cada archivo: unos 12 000 en el árbol.
fn sync_filesystem(dir: &Path) -> io::Result<()> {
    let handle = File::open(dir)?;
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsRawFd;
        // SAFETY: el descriptor es de `handle`, que sigue abierto durante la llamada.
        if unsafe { libc::syncfs(handle.as_raw_fd()) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    handle.sync_all()
}

fn copy(source: &Path, staged: &Path, inventory: &Inventory) -> io::Result<()> {
    for row in &inventory.files {
        let path = relative(&row.path)?;
        copy_verified(&source.join(&path), &staged.join(&path), row)?;
    }
    for row in &inventory.symlinks {
        let path = relative(&row.path)?;
        link_inside(&path, &row.target)?;
        let output = staged.join(&path);
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)?;
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&row.target, &output)?;
        #[cfg(not(unix))]
        return Err(invalid("resource_link"));
    }
    Ok(())
}

fn ready(version: &Path, key: &str) -> bool {
    fs::read_to_string(version.join(READY)).is_ok_and(|text| text == key)
}

fn lock_versions(root: &Path) -> io::Result<File> {
    let lock = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("resource-versions.lock"))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        match lock.try_lock() {
            Ok(()) => return Ok(lock),
            Err(fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(error) => return Err(io::Error::other(error)),
        }
    }
}

/// Un `ready` sin candado exclusivo posible es de un motor vivo: esa carpeta se queda.
fn unlocked(dir: &Path) -> bool {
    match File::open(dir.join(READY)) {
        Ok(marker) => marker.try_lock().is_ok(),
        Err(_) => true,
    }
}

/// Se quedan la versión actual y la anterior. Las demás se borran solo si nadie tiene
/// el candado compartido de su `ready`; las copias viejas sin `ready` no se tocan.
fn collect(versions: &Path, selection: &Selection) {
    let Ok(entries) = fs::read_dir(versions) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(".resources-") {
            // Una copia apartada por daño puede seguir en uso por el motor que la marcó.
            if unlocked(&path) {
                let _ = fs::remove_dir_all(&path);
            }
            continue;
        }
        if !path.is_dir()
            || Some(&name) == selection.current.as_ref()
            || Some(&name) == selection.previous.as_ref()
        {
            continue;
        }
        let Ok(marker) = File::open(path.join(READY)) else {
            continue;
        };
        if marker.try_lock().is_ok() {
            drop(marker);
            let _ = fs::remove_dir_all(&path);
        }
    }
}

fn select(versions: &Path, key: &str) -> io::Result<Selection> {
    let file = versions.join(SELECTION);
    let mut selection: Selection = fs::read(&file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if selection.current.as_deref() != Some(key) {
        selection.previous = selection.current.take();
        selection.current = Some(key.to_string());
        let staged = versions.join(format!(".{SELECTION}.tmp"));
        fs::write(
            &staged,
            serde_json::to_vec(&selection).map_err(io::Error::other)?,
        )?;
        fs::rename(staged, file)?;
    }
    Ok(selection)
}

pub(super) fn materialize(source: &Path, root: &Path) -> io::Result<PathBuf> {
    private_dir(root)?;
    let versions = root.join("resource-versions");
    private_dir(&versions)?;
    let raw = fs::read(source.join(INVENTORY))?;
    let key = format!("{:x}", Sha256::digest(&raw));
    let _lock = lock_versions(root)?;
    let target = versions.join(&key);
    if !ready(&target, &key) {
        let inventory: Inventory =
            serde_json::from_slice(&raw).map_err(|_| invalid("resource_inventory"))?;
        if target.exists() {
            // Sin marca la copia quedó a medias; con otra marca el motor la declaró dañada.
            let aside = versions.join(format!(".resources-{}", uuid::Uuid::new_v4()));
            fs::rename(&target, aside)?;
        }
        let staged = tempfile::Builder::new()
            .prefix(".resources-")
            .tempdir_in(&versions)?;
        copy(source, staged.path(), &inventory)?;
        sync_filesystem(staged.path())?;
        let mut marker = File::create(staged.path().join(READY))?;
        marker.write_all(key.as_bytes())?;
        marker.sync_all()?;
        fs::rename(staged.keep(), &target)?;
        File::open(&versions)?.sync_all()?;
    }
    let selection = select(&versions, &key)?;
    collect(&versions, &selection);
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    /// Recursos de prueba con su inventario, como los escribe `work-tools.py`.
    fn resources(dir: &Path, files: &[(&str, &[u8], u32)], links: &[(&str, &str)]) {
        let _ = fs::remove_dir_all(dir);
        fs::create_dir_all(dir).unwrap();
        let mut rows = Vec::new();
        for (path, bytes, mode) in files {
            let file = dir.join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(&file, bytes).unwrap();
            fs::set_permissions(&file, fs::Permissions::from_mode(*mode)).unwrap();
            rows.push(serde_json::json!({"path": path, "size": bytes.len(), "sha256": sha(bytes), "mode": mode}));
        }
        let symlinks: Vec<_> = links
            .iter()
            .map(|(path, target)| {
                std::os::unix::fs::symlink(target, dir.join(path)).unwrap();
                serde_json::json!({"path": path, "target": target})
            })
            .collect();
        let inventory = serde_json::json!({"schema": 1, "files": rows, "symlinks": symlinks});
        fs::write(dir.join(INVENTORY), serde_json::to_vec(&inventory).unwrap()).unwrap();
    }

    #[test]
    fn copies_once_with_links_and_modes_then_only_reads_the_marker() -> io::Result<()> {
        let lab = tempfile::tempdir()?;
        let source = lab.path().join("mount");
        resources(
            &source,
            &[
                ("work-tools/t/x/python/bin/python3.13", b"elf", 0o755),
                ("lenguas/es.json", b"{}", 0o644),
            ],
            &[("work-tools/t/x/python/bin/python3", "python3.13")],
        );
        let root = lab.path().join("private");
        let copy = materialize(&source, &root)?;
        assert!(copy.join(READY).is_file());
        let bin = copy.join("work-tools/t/x/python/bin");
        assert_eq!(fs::read_link(bin.join("python3"))?, Path::new("python3.13"));
        assert_eq!(
            fs::metadata(bin.join("python3.13"))?.permissions().mode() & 0o777,
            0o755
        );
        assert_eq!(
            fs::metadata(copy.join("lenguas/es.json"))?
                .permissions()
                .mode()
                & 0o777,
            0o644
        );
        // Con la marca puesta no se vuelve a leer ningún byte de los recursos.
        fs::write(source.join("lenguas/es.json"), b"[]")?;
        assert_eq!(materialize(&source, &root)?, copy);
        assert_eq!(fs::read(copy.join("lenguas/es.json"))?, b"{}");
        Ok(())
    }

    #[test]
    fn a_changed_byte_fails_the_copy_and_leaves_no_version() -> io::Result<()> {
        let lab = tempfile::tempdir()?;
        let source = lab.path().join("mount");
        resources(&source, &[("work-tools/a", b"good", 0o644)], &[]);
        fs::write(source.join("work-tools/a"), b"evil")?;
        let root = lab.path().join("private");
        let error = materialize(&source, &root).unwrap_err();
        assert_eq!(error.to_string(), "resource_copy_changed");
        let left: Vec<_> = fs::read_dir(root.join("resource-versions"))?
            .flatten()
            .filter(|e| e.path().is_dir())
            .collect();
        assert!(left.is_empty());
        Ok(())
    }

    #[test]
    fn links_and_paths_cannot_leave_the_copy() -> io::Result<()> {
        let lab = tempfile::tempdir()?;
        for (path, target) in [("a/link", "../../outside"), ("link", "/etc/passwd")] {
            let source = lab.path().join("mount");
            resources(&source, &[("a/file", b"x", 0o644)], &[(path, target)]);
            let error = materialize(&source, &lab.path().join("private")).unwrap_err();
            assert_eq!(error.to_string(), "resource_link");
        }
        let source = lab.path().join("mount");
        resources(&source, &[("a/file", b"x", 0o644)], &[]);
        let raw = fs::read_to_string(source.join(INVENTORY))?.replace("a/file", "../file");
        fs::write(source.join(INVENTORY), raw)?;
        let error = materialize(&source, &lab.path().join("private")).unwrap_err();
        assert_eq!(error.to_string(), "resource_path");
        Ok(())
    }

    #[test]
    fn keeps_current_and_previous_and_never_deletes_a_locked_version() -> io::Result<()> {
        let lab = tempfile::tempdir()?;
        let source = lab.path().join("mount");
        let root = lab.path().join("private");
        resources(&source, &[("v", b"1", 0o644)], &[]);
        let first = materialize(&source, &root)?;
        let engine = File::open(first.join(READY))?;
        engine.lock_shared()?;
        resources(&source, &[("v", b"2", 0o644)], &[]);
        let second = materialize(&source, &root)?;
        resources(&source, &[("v", b"3", 0o644)], &[]);
        let third = materialize(&source, &root)?;
        assert!(first.is_dir(), "an engine still holds the first version");
        drop(engine);
        resources(&source, &[("v", b"4", 0o644)], &[]);
        let fourth = materialize(&source, &root)?;
        assert!(!first.exists() && !second.exists());
        assert!(third.is_dir() && fourth.is_dir());
        Ok(())
    }

    #[test]
    fn concurrent_windows_share_one_copy() -> io::Result<()> {
        let lab = tempfile::tempdir()?;
        let source = lab.path().join("mount");
        resources(&source, &[("catalog.json", b"valid", 0o644)], &[]);
        let root = lab.path().join("private");
        let (one, two) = std::thread::scope(|scope| {
            let one = scope.spawn(|| materialize(&source, &root));
            let two = scope.spawn(|| materialize(&source, &root));
            (one.join(), two.join())
        });
        let one = one.map_err(|_| io::Error::other("thread failed"))??;
        let two = two.map_err(|_| io::Error::other("thread failed"))??;
        assert_eq!(one, two);
        Ok(())
    }

    #[test]
    fn a_copy_without_marker_is_set_aside_not_deleted() -> io::Result<()> {
        let lab = tempfile::tempdir()?;
        let source = lab.path().join("mount");
        resources(&source, &[("catalog.json", b"valid", 0o644)], &[]);
        let root = lab.path().join("private");
        let copy = materialize(&source, &root)?;
        fs::remove_file(copy.join(READY))?;
        let mut open = File::open(copy.join("catalog.json"))?;
        let repaired = materialize(&source, &root)?;
        assert_eq!(repaired, copy);
        assert!(ready(&repaired, &sha(&fs::read(source.join(INVENTORY))?)));
        let mut previous = String::new();
        open.read_to_string(&mut previous)?;
        assert_eq!(previous, "valid");
        Ok(())
    }

    #[test]
    fn a_copy_marked_damaged_is_replaced_and_kept_while_locked() -> io::Result<()> {
        let lab = tempfile::tempdir()?;
        let source = lab.path().join("mount");
        resources(&source, &[("work-tools/a", b"good", 0o644)], &[]);
        let root = lab.path().join("private");
        let copy = materialize(&source, &root)?;
        // Así la marca el motor al reparar: trunca y escribe sobre el descriptor con candado.
        let mut engine = File::options().write(true).open(copy.join(READY))?;
        engine.lock_shared()?;
        fs::write(copy.join("work-tools/a"), b"evil")?;
        engine.set_len(0)?;
        engine.write_all(b"damaged\n")?;
        let versions = root.join("resource-versions");
        let aside = |versions: &Path| -> io::Result<Vec<PathBuf>> {
            Ok(fs::read_dir(versions)?
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with(".resources-"))
                })
                .collect())
        };
        let repaired = materialize(&source, &root)?;
        assert_eq!(repaired, copy);
        assert_eq!(fs::read(repaired.join("work-tools/a"))?, b"good");
        let set_aside = aside(&versions)?;
        assert_eq!(set_aside.len(), 1, "the damaged copy is set aside");
        assert_eq!(fs::read(set_aside[0].join("work-tools/a"))?, b"evil");
        materialize(&source, &root)?;
        assert!(
            set_aside[0].is_dir(),
            "a locked copy survives the collection"
        );
        drop(engine);
        materialize(&source, &root)?;
        assert!(
            aside(&versions)?.is_empty(),
            "an unlocked copy is collected"
        );
        Ok(())
    }
}
