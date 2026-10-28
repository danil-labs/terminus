#!/usr/bin/env python3
"""Firma el código contenido en payloads macOS y conserva la procedencia original."""

import argparse
import base64
import copy
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import secrets
import stat
import subprocess
import tarfile
import tempfile
import time
import zipfile


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("work_tools", ROOT / "scripts/work-tools.py")
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)
MAGIC = {b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca",
         b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xce"}


def execute(args, label, timeout=120):
    try:
        result = subprocess.run([str(a) for a in args], capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"{label}: timeout") from None
    if result.returncode:
        # Las órdenes de security llevan secretos; sus argumentos nunca entran en el error.
        raise RuntimeError(f"{label}: {result.stderr.decode(errors='replace')[-2000:]}")
    return result.stdout.decode(errors="replace") + result.stderr.decode(errors="replace")


def native_files(root):
    result = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open("rb") as stream:
            magic = stream.read(4)
        if magic in MAGIC:
            description = execute(["/usr/bin/file", "-b", path], "inspect Mach-O")
            if "Mach-O" in description and ("executable" in description or "shared library" in description or "bundle" in description):
                result.append((path, "executable" in description))
    return result


def signature(path, executable, team=None):
    execute(["/usr/bin/codesign", "--verify", "--strict", path], "verify native signature")
    info = execute(["/usr/bin/codesign", "-dv", "--verbose=4", path], "inspect native signature")
    if "Authority=Developer ID Application:" not in info or "Timestamp=" not in info or "Timestamp=none" in info:
        raise ValueError(f"Developer ID and secure timestamp required: {path.name}")
    if executable and "runtime" not in info:
        raise ValueError(f"Hardened runtime required: {path.name}")
    if team and f"TeamIdentifier={team}\n" not in info:
        raise ValueError(f"Unexpected native signing team: {path.name}")
    if team and "Authority=Developer ID Application: Software y Servicios Danil" not in info:
        raise ValueError(f"Expected Danil Developer ID: {path.name}")


def unpack(path, root, kind):
    if kind == "tar.gz":
        execute(["/usr/bin/tar", "-xzf", path, "-C", root], "unpack pinned payload")
    else:
        with zipfile.ZipFile(path) as archive:
            for item in archive.infolist():
                tools.relative(item.filename)
                if stat.S_ISLNK(item.external_attr >> 16):
                    raise ValueError("Unexpected symlink in native ZIP")
                archive.extract(item, root)
                mode = (item.external_attr >> 16) & 0o777
                if mode:
                    tools.child(root, item.filename).chmod(mode)


def wheel_record(root):
    records = list(root.glob("*.dist-info/RECORD"))
    if len(records) != 1 or list(root.glob("*.dist-info/RECORD.*")):
        raise ValueError("Expected one unsigned wheel RECORD")
    record = records[0]
    rows = list(csv.reader(io.StringIO(record.read_text())))
    for row in rows:
        path = tools.child(root, row[0])
        if path == record:
            row[1:] = ["", ""]
        else:
            data = path.read_bytes()
            row[1:] = ["sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("="), str(len(data))]
    stream = io.StringIO()
    csv.writer(stream, lineterminator="\n").writerows(rows)
    record.write_text(stream.getvalue())


def repack(path, root, kind):
    output = path.with_name(path.name + ".signed")
    try:
        if kind == "tar.gz":
            with tarfile.open(path, "r:gz") as source, tarfile.open(output, "w:gz") as target:
                for item in source.getmembers():
                    item = copy.copy(item)
                    if item.isdir() and item.name in {".", "./"}:
                        target.addfile(item)
                        continue
                    file = tools.child(root, item.name)
                    if item.isfile():
                        item.size = file.stat().st_size
                        with file.open("rb") as stream:
                            target.addfile(item, stream)
                    else:
                        target.addfile(item)
        else:
            with zipfile.ZipFile(path) as source, zipfile.ZipFile(output, "w") as target:
                for item in source.infolist():
                    target.writestr(item, b"" if item.is_dir() else tools.child(root, item.filename).read_bytes())
        output.replace(path)
    finally:
        output.unlink(missing_ok=True)


class Signer:
    def __init__(self, identity, team, keychain, entitlements):
        self.identity, self.team = identity, team
        self.keychain, self.entitlements = keychain, entitlements

    def sign(self, path, python):
        command = ["/usr/bin/codesign", "--force", "--sign", self.identity, "--timestamp", "--options", "runtime",
                   "--keychain", self.keychain]
        if python:
            command += ["--entitlements", self.entitlements]
        for attempt in range(3):
            try:
                execute(command + [path], "sign native payload")
                return
            except RuntimeError:
                if attempt == 2:
                    raise
                time.sleep(2)


def signing_identity(keychain, configured, team):
    listing = execute(["/usr/bin/security", "find-identity", "-v", "-p", "codesigning", keychain],
                      "resolve imported signing identity")
    candidates = []
    for fingerprint, name in re.findall(r'\d+\)\s+([0-9A-Fa-f]{40})\s+"([^"]+)"', listing):
        if (name.startswith("Developer ID Application: Software y Servicios Danil")
                and name.endswith(f"({team})")
                and (configured in name or configured.lower() == fingerprint.lower())):
            candidates.append(fingerprint)
    if len(candidates) != 1:
        raise ValueError("Expected one valid imported Danil Developer ID matching the configured identity and team")
    return candidates[0]


def transform(path, kind, signer, python=False, wheel=False):
    with tempfile.TemporaryDirectory(prefix="terminus-native-signing-") as temporary:
        root = Path(temporary)
        unpack(path, root, kind)
        native = native_files(root)
        before = {p.relative_to(root).as_posix(): tools.digest(p) for p, _ in native}
        seen = set()
        for p, executable in native:
            inode = (p.stat().st_dev, p.stat().st_ino)
            if inode in seen:
                continue
            seen.add(inode)
            try:
                signature(p, executable)
            except (ValueError, RuntimeError):
                signer.sign(p, python and executable)
                signature(p, executable, signer.team)
        codes = [{"path": p.relative_to(root).as_posix(), "source_sha256": before[p.relative_to(root).as_posix()],
                  "sha256": tools.digest(p)} for p, _ in native]
        if not any(c["sha256"] != c["source_sha256"] for c in codes):
            return None
        if wheel:
            wheel_record(root)
        repack(path, root, kind)
        return codes


def sign_tree(directory, target, signer):
    source = tools.RESOURCES / target
    original = tools.load_manifest(source, target)
    tools.verify_tree(source, directory, original)
    manifest = copy.deepcopy(original)
    records = []
    for item in manifest["entries"] + manifest["documents"]["wheels"]:
        path = tools.child(directory, item["archive"])
        if tools.digest(path) != item["sha256"]:
            raise ValueError("Upstream payload checksum mismatch before signing")
        if item.get("id") in {"computer-use", "uv", "drawio"}:
            continue
        wheel = "id" not in item
        kind = "zip" if wheel else item["format"]
        tools.inspect_archive(path, {"format": kind, "executable": None})
        upstream = item["sha256"]
        codes = transform(path, kind, signer, item.get("id") == "python", wheel)
        if codes:
            item["sha256"] = tools.digest(path)
            if "unpacked_bytes" in item:
                item["unpacked_bytes"] = tools.inspect_archive(path, item)
            if "bytes" in item:
                item["bytes"] = path.stat().st_size
            records.append({"archive": item["archive"], "source_sha256": upstream, "sha256": item["sha256"],
                            "bytes": path.stat().st_size, "code": codes})
    docs = manifest["documents"]
    requirements = tools.child(directory, docs["requirements"])
    requirements.write_text("".join(f'{w["name"]}=={w["version"]} --hash=sha256:{w["sha256"]}\n' for w in docs["wheels"]))
    docs["requirements_sha256"] = tools.digest(requirements)
    manifest["macos_signing"] = {"schema": 1, "source_manifest_sha256": tools.digest(source / "manifest.json"),
                                 "team_id": signer.team, "archives": records}
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    verify_tree(source, directory, target, signer.team)


def verify_tree(source, directory, target, team):
    original = tools.load_manifest(source, target)
    manifest = tools.load_manifest(directory, target)
    receipt = manifest.get("macos_signing", {})
    if (not team or receipt.get("schema") != 1 or receipt.get("team_id") != team
            or receipt.get("source_manifest_sha256") != tools.digest(source / "manifest.json")):
        raise ValueError("Native signing provenance/team mismatch")
    expected = copy.deepcopy(original)
    items = {i["archive"]: i for i in expected["entries"] + expected["documents"]["wheels"]}
    seen = set()
    for record in receipt["archives"]:
        name = record["archive"]
        if name in seen or name not in items:
            raise ValueError("Unexpected signed payload")
        seen.add(name)
        item = items[name]
        if item.get("id") in {"computer-use", "uv", "drawio"} or record["source_sha256"] != item["sha256"]:
            raise ValueError("Protected/upstream payload was replaced")
        path = tools.child(directory, name)
        if record["sha256"] != tools.digest(path) or record["bytes"] != path.stat().st_size:
            raise ValueError("Signed payload checksum mismatch")
        item["sha256"] = record["sha256"]
        if "unpacked_bytes" in item:
            item["unpacked_bytes"] = tools.inspect_archive(path, item)
        if "bytes" in item:
            item["bytes"] = record["bytes"]
        with tempfile.TemporaryDirectory(prefix="terminus-verify-native-") as temporary:
            root = Path(temporary)
            unpack(path, root, item.get("format", "zip"))
            codes = {c["path"]: c for c in record["code"]}
            native = native_files(root)
            if len(codes) != len(record["code"]) or set(codes) != {p.relative_to(root).as_posix() for p, _ in native}:
                raise ValueError("Native code inventory mismatch")
            for p, executable in native:
                code = codes[p.relative_to(root).as_posix()]
                if code["sha256"] != tools.digest(p):
                    raise ValueError("Native code checksum mismatch")
                signature(p, executable, team if code["sha256"] != code["source_sha256"] else None)
    docs = expected["documents"]
    docs["requirements_sha256"] = tools.digest(tools.child(directory, docs["requirements"]))
    actual = {k: v for k, v in manifest.items() if k != "macos_signing"}
    if actual != expected:
        raise ValueError("Signing changed unapproved tool/document metadata")
    if (directory / "browser-navigation.json").read_bytes() != (source / "browser-navigation.json").read_bytes():
        raise ValueError("Signing changed the Chrome catalog")
    tools.verify_tree(directory, directory, manifest)
    tools.verify_documents(directory, manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    if platform.system() != "Darwin":
        raise ValueError("Native resource signing requires macOS")
    identity, team = os.environ["APPLE_SIGNING_IDENTITY"], os.environ["APPLE_TEAM_ID"]
    if not identity or not team:
        raise ValueError("Expected the configured Danil Developer ID")
    with tempfile.TemporaryDirectory(prefix="terminus-signing-keychain-") as temporary:
        root = Path(temporary)
        keychain, certificate = root / "payloads.keychain-db", root / "certificate.p12"
        password = secrets.token_hex(32)
        certificate.write_bytes(base64.b64decode("".join(os.environ["APPLE_CERTIFICATE"].split()), validate=True))
        certificate.chmod(0o600)
        entitlements = root / "python.plist"
        entitlements.write_bytes(plistlib.dumps({"com.apple.security.cs.disable-library-validation": True}))
        keychains = execute(["/usr/bin/security", "list-keychains", "-d", "user"], "read signing keychain search list")
        previous = re.findall(r'"([^"]+)"', keychains)
        created = False
        try:
            execute(["/usr/bin/security", "create-keychain", "-p", password, keychain], "create signing keychain")
            created = True
            execute(["/usr/bin/security", "set-keychain-settings", "-lut", "21600", keychain], "configure signing keychain")
            execute(["/usr/bin/security", "unlock-keychain", "-p", password, keychain], "unlock signing keychain")
            certificate_format = "pemseq" if certificate.read_bytes().lstrip().startswith(b"-----BEGIN ") else "pkcs12"
            execute(["/usr/bin/security", "import", certificate, "-f", certificate_format, "-t", "agg", "-k", keychain,
                     "-P", os.environ["APPLE_CERTIFICATE_PASSWORD"],
                     "-T", "/usr/bin/codesign"], "import signing identity")
            execute(["/usr/bin/security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", password,
                     keychain], "authorize native signing")
            execute(["/usr/bin/security", "list-keychains", "-d", "user", "-s", *previous, keychain],
                    "make imported signing identity available")
            signer = Signer(signing_identity(keychain, identity, team), team, keychain, entitlements)
            for target in ("aarch64-apple-darwin", "x86_64-apple-darwin"):
                sign_tree(args.directory / target, target, signer)
                print(json.dumps({"target": target, "signed_manifest_sha256": tools.digest(args.directory / target / "manifest.json")}))
        finally:
            if created:
                try:
                    execute(["/usr/bin/security", "list-keychains", "-d", "user", "-s", *previous],
                            "restore signing keychain search list")
                finally:
                    execute(["/usr/bin/security", "delete-keychain", keychain], "remove temporary signing keychain")


if __name__ == "__main__":
    main()
