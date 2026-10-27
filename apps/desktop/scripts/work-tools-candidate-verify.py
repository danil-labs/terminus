#!/usr/bin/env python3
"""Verifica los bytes finales de una AppImage local y registra la transformación ELF."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree(root):
    files = {}
    for path in root.rglob('*'):
        if path.is_symlink():
            raise ValueError(f'Unexpected resource symlink: {path}')
        if path.is_file():
            files[path.relative_to(root).as_posix()] = digest(path)
    return files


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--candidate', type=Path, required=True)
parser.add_argument('--appimage', type=Path, required=True)
parser.add_argument('--patchelf', type=Path, required=True)
args = parser.parse_args()
metadata_path = args.candidate.resolve()
metadata = json.loads(metadata_path.read_text())
base = metadata_path.parent
target = metadata['target']
if target != 'x86_64-unknown-linux-gnu' or metadata['published_engine_lock']:
    raise ValueError('Expected the unpublished native Linux overlay')
source = base / 'binaries' / f'seldon-runtime-{target}'
if digest(source) != metadata['engine_sha256']:
    raise ValueError('Candidate source engine SHA-256 mismatch')
lock = json.loads((Path(__file__).resolve().parent.parent / 'seldon-runtime.lock').read_text())
if any(pin['sha256'] == digest(source) for pin in lock['platforms'].values()):
    raise ValueError('Candidate engine is the old published pin')
appimage = args.appimage.resolve()
patchelf = args.patchelf.resolve()
with tempfile.TemporaryDirectory(prefix='candidate-appimage-') as temporary:
    lab = Path(temporary)
    subprocess.run([str(appimage), '--appimage-extract'], cwd=lab, check=True, stdout=subprocess.DEVNULL)
    unpacked = lab / 'squashfs-root'
    engine = unpacked / 'usr/bin/seldon-runtime'
    expected = lab / 'expected-engine'
    shutil.copy2(source, expected)
    subprocess.run([str(patchelf), '--set-rpath', '$ORIGIN/../lib', str(expected)], check=True)
    if digest(engine) != digest(expected):
        raise ValueError('Packaged engine differs beyond the expected linuxdeploy RUNPATH transformation')
    resources = unpacked / 'usr/lib/Terminus/work-tools' / target
    if tree(resources) != tree(base / metadata['resources']):
        raise ValueError('Packaged work tools differ from the verified overlay')
    if digest(resources / 'manifest.json') != metadata['resource_manifest_sha256']:
        raise ValueError('Packaged resource manifest SHA-256 mismatch')
    manifest = json.loads((resources / 'manifest.json').read_text())
    documents = manifest['documents']
    entries = manifest['entries'] + documents['wheels'] + [{'archive': documents['requirements'], 'sha256': documents['requirements_sha256']}]
    for entry in entries:
        path = resources / entry['archive']
        if not path.resolve().is_relative_to(resources.resolve()) or digest(path) != entry['sha256']:
            raise ValueError(f'Packaged payload SHA-256 mismatch: {entry["archive"]}')
    if digest(resources / 'browser-navigation.json') != metadata['browser_catalog_sha256']:
        raise ValueError('Packaged browser catalog SHA-256 mismatch')
    metadata['appimage'] = {'file': str(appimage), 'bytes': appimage.stat().st_size, 'sha256': digest(appimage)}
    metadata['packaged_engine_sha256'] = digest(engine)
    metadata['packaged_window_sha256'] = digest(unpacked / 'usr/bin/terminus')
    metadata['engine_transform'] = {'command': 'patchelf --set-rpath $ORIGIN/../lib', 'patchelf_sha256': digest(patchelf), 'byte_exact': True}
    metadata['packaged_resources_byte_exact'] = True
staged = metadata_path.with_suffix('.verified.tmp')
staged.write_text(json.dumps(metadata, indent=2) + '\n')
staged.replace(metadata_path)
print(json.dumps(metadata, indent=2))
