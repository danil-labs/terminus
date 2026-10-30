#!/usr/bin/env python3
"""Comprueba identidad nativa sin ejecutar el código de la candidata."""
import json
import os
from pathlib import Path
import plistlib
import subprocess

app = Path('candidate/Terminus.app')
config = json.loads(Path('apps/desktop/src-tauri/tauri.conf.json').read_text())
manifest = json.loads(Path('candidate/manifest.json').read_text())
with (app / 'Contents/Info.plist').open('rb') as stream:
    info = plistlib.load(stream)
expected = {'CFBundleIdentifier': config['identifier'], 'CFBundleName': config['productName'],
            'CFBundleExecutable': 'terminus', 'CFBundleShortVersionString': config['version'],
            'CFBundleVersion': config['version']}
for key, value in expected.items():
    if info.get(key) != value:
        raise ValueError('Native Mac identity mismatch: ' + key)
binary = app / 'Contents/MacOS/terminus'
architectures = sorted(subprocess.check_output(['lipo', '-archs', str(binary)], text=True).split())
if architectures != sorted(manifest['architectures']):
    raise ValueError('Native architecture mismatch')
subprocess.run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app)], check=True)
result = subprocess.run(['codesign', '-dv', '--verbose=4', str(app)], check=True, capture_output=True, text=True)
if ('Developer ID Application: Software y Servicios Danil' not in result.stderr or
        'TeamIdentifier=ATG57AXYTS' not in result.stderr or 'runtime' not in result.stderr):
    raise ValueError('Expected Danil Developer ID and hardened runtime')
Path(os.environ['RUNNER_TEMP'], 'native-identity.json').write_text(json.dumps({**expected, 'architectures': architectures}, indent=2) + '\n')
