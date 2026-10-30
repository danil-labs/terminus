#!/usr/bin/env python3
"""Lee ELF y SquashFS con herramientas del runner, sin ejecutar la candidata."""
import json
import os
from pathlib import Path
import struct
import subprocess


def elf_x64(data):
    if data[:6] != b'\x7fELF\x02\x01' or len(data) < 64 or struct.unpack_from('<H', data, 18)[0] != 62:
        raise ValueError('Expected little-endian x86_64 ELF')


manifest = json.loads(Path('candidate/manifest.json').read_text())
config = json.loads(Path('apps/desktop/src-tauri/tauri.conf.json').read_text())
image = Path('candidate') / manifest['appimage']
with image.open('rb') as stream:
    header = stream.read(64)
elf_x64(header)
if header[8:11] != b'AI\x02':
    raise ValueError('Expected AppImage type 2')
offset = manifest.get('squashfs_offset')
if type(offset) is not int or offset < 64 or offset >= image.stat().st_size:
    raise ValueError('Missing reviewed SquashFS offset')


def member(name, limit):
    # -cat no extrae archivos ni interpreta AppRun o el ejecutable de la app.
    process = subprocess.Popen(['unsquashfs', '-cat', '-o', str(offset), str(image), name], stdout=subprocess.PIPE)
    try:
        value = process.stdout.read(limit + 1)
        if len(value) > limit:
            raise ValueError('Native inspection resource limit')
        if process.wait(timeout=60) != 0:
            raise ValueError('SquashFS member unavailable')
        return value
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


desktop = member('usr/share/applications/Terminus.desktop', 65536).decode('utf-8')
if 'Name=Terminus\n' not in desktop or 'Exec=terminus\n' not in desktop:
    raise ValueError('Desktop identity mismatch')
binary = member('usr/bin/terminus', 256 * 1024 * 1024)
elf_x64(binary)
if config['identifier'].encode() not in binary:
    raise ValueError('Embedded native identity marker missing')
receipt = {'architecture': 'x86_64', 'appimage_type': 2, 'desktop_name': 'Terminus',
           'identifier_marker': config['identifier'], 'version_source': 'externally pinned reviewed build/QA receipt',
           'limitation': 'ELF has no structured application version field; version is attributed by reviewed build hashes, not parsed from ELF'}
Path(os.environ['RUNNER_TEMP'], 'native-identity.json').write_text(json.dumps(receipt, indent=2) + '\n')
