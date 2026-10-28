#!/usr/bin/env python3
"""Prepara y verifica los mismos recursos en las tres distribuciones de escritorio."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("work_tools", ROOT / "scripts/work-tools.py")
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)


def targets():
    return {"Darwin": ["aarch64-apple-darwin", "x86_64-apple-darwin"],
            "Windows": ["x86_64-pc-windows-msvc"],
            "Linux": ["x86_64-unknown-linux-gnu"]}[platform.system()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "verify"])
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        config = args.directory / "tauri.work-tools.json"
        command = [sys.executable, str(ROOT / "scripts/work-tools.py"), "prepare", "--download",
                   "--max-download-bytes", str(1024 ** 3), "--output", str(args.directory / "work-tools"),
                   "--tauri-config", str(config)]
        for target in targets():
            command += ["--target", target]
        subprocess.run(command, check=True)
        if os.environ.get("GITHUB_ENV"):
            environment = {"WORK_TOOLS_CONFIG": str(config.resolve())}
            if platform.system() == "Linux":
                import shutil
                environment.update(PATCHELF=str(ROOT / "scripts/work-tools-patchelf.py"),
                    TERMINUS_REAL_PATCHELF=shutil.which("patchelf"),
                    TERMINUS_WORK_TOOLS_ROOT=str(ROOT / "src-tauri/target/release/bundle/appimage/Terminus.AppDir/usr/lib/Terminus/work-tools"))
            with open(os.environ["GITHUB_ENV"], "a") as stream:
                for key, value in environment.items():
                    stream.write(f"{key}={value}\n")
    else:
        reports = []
        for target in targets():
            source = ROOT / "resources/work-tools" / target
            manifest = tools.load_manifest(source, target)
            directory = args.directory / target
            tools.verify_tree(source, directory, manifest)
            for item in manifest["entries"]:
                archive = tools.child(directory, item["archive"])
                if tools.digest(archive) != item["sha256"]:
                    raise ValueError(f"Packaged tool checksum mismatch: {item['id']}")
                tools.inspect_archive(archive, item)
                if item["id"] == "computer-use":
                    tools.verify_cua(archive, target)
            tools.verify_documents(directory, manifest)
            reports.append({"target": target, "manifest_sha256": tools.digest(directory / "manifest.json"),
                            "bytes": sum(p.stat().st_size for p in directory.rglob("*") if p.is_file())})
        print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    main()
