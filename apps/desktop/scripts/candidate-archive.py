#!/usr/bin/env python3
"""Inspecciona el ZIP completo antes de crear el directorio de extracción."""
import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import unicodedata
import zipfile


def safe_name(name):
    parts = name.rstrip('/').split('/')
    if (not name or name.startswith('/') or '\\' in name or ':' in name or
            any(ord(c) < 32 for c in name) or any(p in ('', '.', '..') for p in parts) or
            any(p.endswith((' ', '.')) for p in parts) or
            any(re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', p, re.I) for p in parts)):
        raise ValueError('Unsafe archive path: ' + name)
    return '/'.join(parts)


def inspect(archive, platform):
    entries, folded, links, directories, aliases = {}, set(), {}, set(), {}
    total = 0
    for info in archive.infolist():
        name = safe_name(info.filename)
        key = unicodedata.normalize('NFC', name).casefold()
        if key in folded:
            raise ValueError('Duplicate/case alias: ' + name)
        folded.add(key)
        for length in range(1, len(name.split('/')) + 1):
            prefix = '/'.join(name.split('/')[:length])
            alias = unicodedata.normalize('NFC', prefix).casefold()
            if alias in aliases and aliases[alias] != prefix:
                raise ValueError('Aliased archive ancestor: ' + prefix)
            aliases[alias] = prefix
        kind = stat.S_IFMT(info.external_attr >> 16)
        if info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise ValueError('Unsupported/encrypted ZIP entry')
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK):
            raise ValueError('Special archive entry: ' + name)
        if (kind == stat.S_IFDIR and not info.is_dir()) or (info.is_dir() and kind not in (0, stat.S_IFDIR)):
            raise ValueError('Inconsistent archive type: ' + name)
        total += info.file_size
        if len(entries) >= 100000 or total > 16 * 1024**3 or info.file_size > 4 * 1024**3:
            raise ValueError('Archive resource limit')
        if info.file_size > max(info.compress_size, 1) * 1000:
            raise ValueError('Archive compression limit')
        # open valida también nombre local, offsets y entradas solapadas.
        with archive.open(info) as stream:
            stream.read(0)
        entries[name] = info
        for parent in PurePosixPath(name).parents:
            if str(parent) != '.':
                directories.add(str(parent))
        if info.is_dir():
            directories.add(name)
        if kind == stat.S_IFLNK:
            if platform != 'macos' or info.file_size > 4096:
                raise ValueError('Symlinks forbidden for this input')
            target = archive.read(info).decode('utf-8')
            if not target or target.startswith('/') or '\\' in target or ':' in target or '\x00' in target:
                raise ValueError('Unsafe symlink: ' + name)
            links[name] = target
    for directory in directories:
        if directory in entries and not entries[directory].is_dir():
            raise ValueError('File/link is an archive ancestor: ' + directory)
    available = set(entries) | directories
    for name, target in links.items():
        parts = list(PurePosixPath(name).parent.parts) + target.split('/')
        for _ in range(64):
            normalized = []
            for part in parts:
                if part in ('', '.'):
                    continue
                if part == '..':
                    if not normalized:
                        raise ValueError('Escaping symlink: ' + name)
                    normalized.pop()
                else:
                    normalized.append(part)
            resolved = '/'.join(normalized)
            replaced = False
            for i in range(1, len(normalized) + 1):
                prefix = '/'.join(normalized[:i])
                if prefix in links:
                    parts = normalized[:i - 1] + links[prefix].split('/') + normalized[i:]
                    replaced = True
                    break
            if not replaced:
                if resolved not in available:
                    raise ValueError('Dangling symlink: ' + name)
                break
        else:
            raise ValueError('Cyclic symlink: ' + name)
    return entries, links


def extract(source, destination, expected_hash, platform):
    if not re.fullmatch('[a-fA-F0-9]{64}', expected_hash):
        raise ValueError('Invalid archive SHA256')
    digest = hashlib.sha256()
    with open(source, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != expected_hash.lower():
        raise ValueError('Archive hash mismatch')
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError('Destination must not exist')
    with zipfile.ZipFile(source) as archive:
        entries, links = inspect(archive, platform)
        # Ninguna escritura ocurre antes de inspeccionar todas las entradas.
        destination.mkdir()
        try:
            for name, info in entries.items():
                target = destination / name
                if name in links:
                    continue
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as src, target.open('xb') as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
                os.chmod(target, (info.external_attr >> 16) & 0o777 or 0o644)
            for name, target in links.items():
                link = destination / name
                link.parent.mkdir(parents=True, exist_ok=True)
                link.symlink_to(target)
        except BaseException:
            shutil.rmtree(destination)
            raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('destination')
    parser.add_argument('sha256')
    parser.add_argument('platform', choices=('windows', 'macos', 'linux'))
    args = parser.parse_args()
    extract(args.source, args.destination, args.sha256, args.platform)
