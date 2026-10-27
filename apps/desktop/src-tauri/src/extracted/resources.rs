//! La copia de recursos de un AppImage conserva cada versión mientras el motor la usa.

use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

fn private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn entries(root: &Path) -> io::Result<Vec<PathBuf>> {
    let mut paths = fs::read_dir(root)?
        .map(|entry| entry.map(|e| e.path()))
        .collect::<io::Result<Vec<_>>>()?;
    paths.sort();
    Ok(paths)
}

fn hash_tree(root: &Path) -> io::Result<String> {
    fn visit(root: &Path, dir: &Path, hash: &mut Sha256) -> io::Result<()> {
        for path in entries(dir)? {
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() || (!metadata.is_dir() && !metadata.is_file()) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "resource_not_regular",
                ));
            }
            let name = path.strip_prefix(root).map_err(io::Error::other)?;
            let bytes = name.as_os_str().as_encoded_bytes();
            hash.update((bytes.len() as u64).to_le_bytes());
            hash.update(bytes);
            if metadata.is_dir() {
                hash.update(b"directory");
                visit(root, &path, hash)?;
            } else {
                hash.update(b"file");
                hash.update(metadata.len().to_le_bytes());
                let mut input = File::open(path)?;
                let mut buffer = [0; 65536];
                loop {
                    let count = input.read(&mut buffer)?;
                    if count == 0 {
                        break;
                    }
                    hash.update(&buffer[..count]);
                }
            }
        }
        Ok(())
    }
    let mut hash = Sha256::new();
    visit(root, root, &mut hash)?;
    Ok(format!("{:x}", hash.finalize()))
}

fn copy_tree(source: &Path, target: &Path) -> io::Result<()> {
    private_dir(target)?;
    for path in entries(source)? {
        let metadata = fs::symlink_metadata(&path)?;
        let output = target.join(
            path.file_name()
                .ok_or_else(|| io::Error::other("resource_name"))?,
        );
        if metadata.is_dir() {
            copy_tree(&path, &output)?;
        } else if metadata.is_file() {
            fs::copy(path, output)?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "resource_not_regular",
            ));
        }
    }
    Ok(())
}

fn sync_tree(root: &Path) -> io::Result<()> {
    for path in entries(root)? {
        if path.is_dir() {
            sync_tree(&path)?;
        } else {
            File::open(path)?.sync_all()?;
        }
    }
    File::open(root)?.sync_all()
}

pub(super) fn materialize(source: &Path, root: &Path) -> io::Result<PathBuf> {
    private_dir(root)?;
    let versions = root.join("resource-versions");
    private_dir(&versions)?;
    let lock = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("resource-versions.lock"))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        match lock.try_lock() {
            Ok(()) => break,
            Err(std::fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(error) => return Err(io::Error::other(error)),
        }
    }
    let digest = hash_tree(source)?;
    let mut target = versions.join(&digest);
    if target.is_dir() {
        if hash_tree(&target).is_ok_and(|hash| hash == digest) {
            return Ok(target);
        }
        for previous in entries(&versions)? {
            if previous
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with(&format!("{digest}-")))
                && hash_tree(&previous).is_ok_and(|hash| hash == digest)
            {
                return Ok(previous);
            }
        }
        // Una copia dañada puede seguir abierta: la reparación recibe otra ruta.
        target = versions.join(format!("{digest}-{}", uuid::Uuid::new_v4()));
    }
    let staged = tempfile::Builder::new()
        .prefix(".resources-")
        .tempdir_in(&versions)?;
    copy_tree(source, staged.path())?;
    if hash_tree(staged.path())? != digest {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "resource_copy_changed",
        ));
    }
    sync_tree(staged.path())?;
    fs::rename(staged.path(), &target)?;
    File::open(&versions)?.sync_all()?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_size_changes_keep_both_resource_versions() -> io::Result<()> {
        let lab = tempfile::tempdir()?;
        let source = lab.path().join("source");
        private_dir(&source)?;
        fs::write(source.join("manifest.json"), "first")?;
        let root = lab.path().join("private");
        let first = materialize(&source, &root)?;
        assert_eq!(materialize(&source, &root)?, first);
        let mut open = File::open(first.join("manifest.json"))?;
        fs::write(source.join("manifest.json"), "other")?;
        let second = materialize(&source, &root)?;
        assert_ne!(first, second);
        let mut previous = String::new();
        open.read_to_string(&mut previous)?;
        assert_eq!(previous, "first");
        fs::remove_dir_all(source)?;
        assert_eq!(fs::read_to_string(second.join("manifest.json"))?, "other");
        Ok(())
    }

    #[test]
    fn concurrent_windows_share_one_verified_copy_and_repair_without_deletion() -> io::Result<()> {
        let lab = tempfile::tempdir()?;
        let source = lab.path().join("source");
        private_dir(&source)?;
        fs::write(source.join("catalog.json"), "valid")?;
        let root = lab.path().join("private");
        let (one, two) = std::thread::scope(|scope| {
            let one = scope.spawn(|| materialize(&source, &root));
            let two = scope.spawn(|| materialize(&source, &root));
            (one.join(), two.join())
        });
        let one = one.map_err(|_| io::Error::other("thread failed"))??;
        let two = two.map_err(|_| io::Error::other("thread failed"))??;
        assert_eq!(one, two);
        fs::write(one.join("catalog.json"), "broke")?;
        let repaired = materialize(&source, &root)?;
        assert_ne!(one, repaired);
        assert!(one.is_dir());
        assert_eq!(fs::read_to_string(repaired.join("catalog.json"))?, "valid");
        Ok(())
    }
    #[test]
    fn an_unverifiable_copy_is_retained_and_repaired() -> io::Result<()> {
        let lab = tempfile::tempdir()?;
        let source = lab.path().join("source");
        private_dir(&source)?;
        fs::write(source.join("catalog.json"), "valid")?;
        let root = lab.path().join("private");
        let previous = materialize(&source, &root)?;
        fs::remove_file(previous.join("catalog.json"))?;
        std::os::unix::fs::symlink("missing", previous.join("catalog.json"))?;
        let repaired = materialize(&source, &root)?;
        assert_ne!(repaired, previous);
        assert!(previous.join("catalog.json").is_symlink());
        assert_eq!(fs::read_to_string(repaired.join("catalog.json"))?, "valid");
        Ok(())
    }
}
