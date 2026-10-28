#!/usr/bin/env python3
"""Stage pinned work tools for desktop and headless packages, without installing them.

Examples (from apps/desktop):
  python3 scripts/work-tools.py plan --target x86_64-unknown-linux-gnu
  python3 scripts/work-tools.py prepare --target x86_64-unknown-linux-gnu --cache /cache --download
  python3 scripts/work-tools.py verify --target x86_64-unknown-linux-gnu

prepare writes resources/work-tools/<target> by default. Pass --output to stage
that same directory for a headless package. Copy the whole target directory;
manifest.json and documents-requirements.txt remain byte-exact. --tauri-config
writes a Tauri config overlay only after every selected payload verifies.
Chrome's browser-navigation.json is metadata only; Chrome is never staged.
"""

import argparse
import contextlib
import email
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[1]
RESOURCES = ROOT / "resources" / "work-tools"
REQUIRED = {"git", "python", "uv", "ripgrep", "agent-browser", "drawio", "computer-use"}


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def relative(value):
    if not isinstance(value, str) or not value or "\\" in value or ":" in value:
        raise ValueError(f"Unsafe relative path: {value!r}")
    path = PurePosixPath(value)
    if not path.parts or path.is_absolute() or ".." in path.parts or any(ord(c) < 32 for c in value):
        raise ValueError(f"Unsafe relative path: {value!r}")
    return path


def child(root, value):
    path = root.joinpath(*relative(value).parts)
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Path escapes root: {value}")
    return path


def load_manifest(directory, target):
    data = json.loads((directory / "manifest.json").read_text())
    if data["schema"] != 1 or data["target"] != target:
        raise ValueError("Manifest schema/target mismatch")
    entries = data["entries"]
    if {e["id"] for e in entries} != REQUIRED or len(entries) != len(REQUIRED):
        raise ValueError("Base must contain exactly the seven authorized tools")
    relative(data["documents"]["requirements"])
    if not re.fullmatch(r"[0-9a-f]{64}", data["documents"]["requirements_sha256"]):
        raise ValueError("Expected a pinned requirements SHA-256")
    for item in entries + data["documents"]["wheels"]:
        relative(item["archive"])
        if not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise ValueError("Expected a pinned SHA-256")
        if not item["url"].startswith("https://") or not item["license"]:
            raise ValueError("Expected HTTPS provenance and license")
        if item.get("download_sha256") and not re.fullmatch(r"[0-9a-f]{64}", item["download_sha256"]):
            raise ValueError("Expected a pinned native source SHA-256")
    for item in entries:
        if item["format"] not in {"tar.gz", "zip", "raw"}:
            raise ValueError("Unsupported payload format")
        if type(item.get("strip_components", 0)) is not int or item.get("strip_components", 0) < 0:
            raise ValueError("Invalid strip_components")
        if item["executable"] is not None:
            relative(item["executable"])
    return data


def check_link(name, link, hard=False):
    if not link or link.startswith(("/", "\\")) or "\\" in link or ":" in link:
        raise ValueError(f"Unsafe archive link: {name} -> {link}")
    parts = [] if hard else list(PurePosixPath(name).parent.parts)
    for part in PurePosixPath(link).parts:
        if part == "..":
            if not parts:
                raise ValueError(f"Archive link escapes root: {name}")
            parts.pop()
        elif part != ".":
            parts.append(part)


def inspect_archive(path, item):
    if item["format"] == "raw":
        return path.stat().st_size
    strip = item.get("strip_components", 0)
    executable = item["executable"]
    found = executable is None
    size = 0
    with contextlib.ExitStack() as stack:
        if item["format"] == "zip":
            archive = stack.enter_context(zipfile.ZipFile(path))
            members = [(m.filename, m.file_size, m.is_dir(), m) for m in archive.infolist()]
        else:
            archive = stack.enter_context(tarfile.open(path, "r:gz"))
            members = [(m.name, m.size, m.isdir(), m) for m in archive.getmembers()]
        for name, length, is_dir, member in members:
            if is_dir and name in {".", "./"}:
                continue
            parts = relative(name).parts
            if item["format"] == "zip":
                if stat.S_ISLNK(member.external_attr >> 16):
                    check_link(name, archive.read(member).decode("utf-8"))
            elif member.issym() or member.islnk():
                check_link(name, member.linkname, member.islnk())
            elif not member.isfile() and not is_dir:
                raise ValueError(f"Unsupported archive member: {name}")
            if not is_dir:
                size += length
                if len(parts) > strip and "/".join(parts[strip:]) == executable:
                    found = True
        if not found:
            raise ValueError(f"Executable {executable} missing in {path.name}")
    return size


def verify_cua(path, target):
    if "apple-darwin" not in target:
        return "not-applicable"
    if platform.system() != "Darwin":
        raise ValueError("Cua macOS signature verification requires a macOS packaging runner")
    with tempfile.TemporaryDirectory(prefix="terminus-cua-signature-") as temp:
        subprocess.run(["/usr/bin/tar", "-xzf", str(path), "-C", temp], check=True, timeout=120)
        apps = list(Path(temp).glob("*/CuaDriver.app"))
        if len(apps) != 1:
            raise ValueError("Expected one intact CuaDriver.app")
        subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", "--verbose=2", str(apps[0])],
                       check=True, timeout=60)
    return "codesign-deep-strict"


def obtain(item, destination, caches, download, budget):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if digest(destination) != item["sha256"]:
            raise ValueError(f"Existing payload checksum mismatch: {destination.name}")
        return
    if item.get("download_sha256"):
        with tempfile.TemporaryDirectory(prefix=".work-tools-native-", dir=destination.parent) as temporary:
            original = Path(temporary) / Path(item["url"]).name
            obtain({**item, "archive": original.name, "sha256": item["download_sha256"],
                    "download_sha256": None}, original, caches, download, budget)
            envelope = Path(temporary) / "envelope.zip"
            with zipfile.ZipFile(envelope, "w", compression=zipfile.ZIP_STORED) as archive:
                info = zipfile.ZipInfo(item["executable"], date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o755) << 16
                archive.writestr(info, original.read_bytes())
            if digest(envelope) != item["sha256"]:
                raise ValueError("Native payload envelope checksum mismatch")
            os.replace(envelope, destination)
        return
    name = Path(item["archive"]).name
    candidates = [cache / name for cache in caches]
    candidates += [cache / item["archive"] for cache in caches]
    candidates += [cache / item["sha256"] for cache in caches]
    # The audit cache used this alias; its content still has to match the pin.
    if item.get("id") == "drawio":
        candidates += [cache / "drawio.tgz" for cache in caches]
    source = next((p for p in candidates if p.is_file() and digest(p) == item["sha256"]), None)
    if source is None and not download:
        raise ValueError(f"Not cached: {name}; use --download explicitly")
    fd, temporary = tempfile.mkstemp(prefix=".payload-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            if source:
                with source.open("rb") as inp:
                    shutil.copyfileobj(inp, out)
            else:
                request = urllib.request.Request(item["url"], headers={"User-Agent": "Terminus-work-tools/1"})
                with urllib.request.urlopen(request, timeout=60) as inp:
                    if not inp.url.startswith("https://"):
                        raise ValueError("Refusing insecure download redirect")
                    while chunk := inp.read(1024 * 1024):
                        budget[0] -= len(chunk)
                        if budget[0] < 0:
                            raise ValueError("Download byte budget exceeded")
                        out.write(chunk)
        if digest(Path(temporary)) != item["sha256"]:
            raise ValueError(f"Download checksum mismatch: {name}")
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)


def verify_documents(directory, manifest):
    docs = manifest["documents"]
    requirements_path = child(directory, docs["requirements"])
    if digest(requirements_path) != docs["requirements_sha256"]:
        raise ValueError("Requirements checksum mismatch")
    requirements = requirements_path.read_text()
    expected = "".join(f'{w["name"]}=={w["version"]} --hash=sha256:{w["sha256"]}\n' for w in docs["wheels"])
    if requirements != expected:
        raise ValueError("Requirements must pin every wheel and hash exactly")
    for wheel in docs["wheels"]:
        path = child(directory, wheel["archive"])
        if digest(path) != wheel["sha256"]:
            raise ValueError(f"Wheel checksum mismatch: {path.name}")
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                relative(name)
            metadata = [n for n in archive.namelist() if n.endswith(".dist-info/METADATA")]
            if len(metadata) != 1:
                raise ValueError("Expected wheel metadata")
            info = email.message_from_bytes(archive.read(metadata[0]))
            normalize = lambda name: re.sub(r"[-_.]+", "-", name).lower()
            if normalize(info["Name"]) != normalize(wheel["name"]) or info["Version"] != wheel["version"]:
                raise ValueError("Wheel identity mismatch")


def verify_tree(source, destination, manifest):
    metadata = ["manifest.json", manifest["documents"]["requirements"], "browser-navigation.json"]
    for name in metadata:
        if child(destination, name).read_bytes() != child(source, name).read_bytes():
            raise ValueError(f"Output metadata differs from checked-in pin: {name}")
    browser = json.loads((source / "browser-navigation.json").read_text())
    entry = browser["entry"]
    if (browser["schema"] != 1 or browser["target"] != manifest["target"]
            or entry["id"] != "browser-navigation" or entry["format"] != "zip"
            or entry["strip_components"] != 0 or type(entry["bytes"]) is not int or entry["bytes"] <= 0
            or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) or not entry["url"].startswith("https://")):
        raise ValueError("Invalid pinned Chrome navigation catalog")
    relative(entry["archive"])
    relative(entry["executable"])
    licenses = [p for p in (RESOURCES / "licenses").iterdir() if p.is_file()]
    allowed = set(metadata)
    allowed.update(item["archive"] for item in manifest["entries"] + manifest["documents"]["wheels"])
    for license in licenses:
        name = "licenses/" + license.name
        allowed.add(name)
        if child(destination, name).read_bytes() != license.read_bytes():
            raise ValueError(f"Output license differs from source: {name}")
    for path in destination.rglob("*"):
        if path.is_symlink() or (path.is_file() and path.relative_to(destination).as_posix() not in allowed):
            raise ValueError(f"Unexpected resource (base must not contain Chrome or extra tools): {path.name}")


def prepare(args, target, budget):
    source = RESOURCES / target
    manifest = load_manifest(source, target)
    dest = args.output / target
    if args.command == "prepare":
        dest.mkdir(parents=True, exist_ok=True)
        for name in ["manifest.json", manifest["documents"]["requirements"], "browser-navigation.json"]:
            if source.joinpath(name).resolve() != dest.joinpath(name).resolve():
                shutil.copyfile(source / name, dest / name)
        shutil.copytree(RESOURCES / "licenses", dest / "licenses", dirs_exist_ok=True)
        for item in manifest["entries"] + manifest["documents"]["wheels"]:
            obtain(item, child(dest, item["archive"]), args.cache, args.download, budget)
    verify_tree(source, dest, manifest)
    report = {"target": target, "manifest_sha256": digest(source / "manifest.json"), "payloads": []}
    for item in manifest["entries"]:
        path = child(dest, item["archive"])
        if digest(path) != item["sha256"]:
            raise ValueError(f'Payload checksum mismatch: {item["id"]}')
        unpacked = inspect_archive(path, item)
        row = {"id": item["id"], "bytes": path.stat().st_size, "unpacked_bytes": unpacked}
        if item["id"] == "computer-use":
            row["signature"] = verify_cua(path, target)
        report["payloads"].append(row)
    verify_documents(dest, manifest)
    report["staged_bytes"] = sum(p.stat().st_size for p in dest.rglob("*") if p.is_file())
    report["complete"] = True
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["plan", "prepare", "verify"])
    parser.add_argument("--target", required=True, action="append", choices=sorted(p.name for p in RESOURCES.iterdir() if (p / "manifest.json").exists()))
    parser.add_argument("--output", type=Path, default=RESOURCES, help="Root containing target directories")
    parser.add_argument("--cache", action="append", type=Path, default=[])
    parser.add_argument("--download", action="store_true", help="Permit downloading missing base payloads (never Chrome)")
    parser.add_argument("--max-download-bytes", type=int, default=200 * 1024 * 1024)
    parser.add_argument("--tauri-config", type=Path, help="Generate a resource-only overlay; merge with platform/signing config")
    args = parser.parse_args()
    budget = [args.max_download_bytes]
    reports = []
    for target in args.target:
        if args.command == "plan":
            reports.append(load_manifest(RESOURCES / target, target))
        else:
            reports.append(prepare(args, target, budget))
    if args.tauri_config:
        if args.command == "plan":
            parser.error("Cannot generate a Tauri config before payload verification")
        resources = {str((args.output / target).resolve()): f"work-tools/{target}/" for target in args.target}
        args.tauri_config.parent.mkdir(parents=True, exist_ok=True)
        args.tauri_config.write_text(json.dumps({"bundle": {"resources": resources}}, indent=2) + "\n")
    print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.SubprocessError, tarfile.TarError, zipfile.BadZipFile) as error:
        print(f"work-tools: {error}", file=sys.stderr)
        sys.exit(1)
