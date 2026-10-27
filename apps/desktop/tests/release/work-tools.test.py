import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location("work_tools", Path(__file__).resolve().parents[2] / "scripts/work-tools.py")
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)


class WorkToolsTests(unittest.TestCase):
    def test_manifest_and_payload_paths_cannot_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ["../tool", "/tmp/tool", "C:/tool", "dir\\tool", ".", "a/../../b"]:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    tools.child(root, name)
            try:
                (root / "link").symlink_to(root.parent, target_is_directory=True)
            except OSError:
                if os.name == "nt":
                    return
                raise
            with self.assertRaises(ValueError):
                tools.child(root, "link/escaped")

    def test_bad_checksum_never_promotes_and_existing_payload_survives(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / "payload"
            item = {"archive": "payload", "sha256": "0" * 64, "url": "https://example.invalid/tool"}
            with patch.object(tools.urllib.request, "urlopen") as fetch:
                fetch.return_value.__enter__.return_value = io.BytesIO(b"wrong bytes")
                fetch.return_value.__enter__.return_value.url = item["url"]
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    tools.obtain(item, dest, [], True, [1024])
            self.assertFalse(dest.exists())
            self.assertEqual(list(Path(temp).iterdir()), [])
            dest.write_bytes(b"keep")
            with self.assertRaises(ValueError):
                tools.obtain(item, dest, [], True, [1024])
            self.assertEqual(dest.read_bytes(), b"keep")

    def test_budget_failure_cleans_partial_download(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / "payload"
            item = {"archive": "payload", "sha256": "0" * 64, "url": "https://example.invalid/tool"}
            with patch.object(tools.urllib.request, "urlopen") as fetch:
                fetch.return_value.__enter__.return_value = io.BytesIO(b"too large")
                fetch.return_value.__enter__.return_value.url = item["url"]
                with self.assertRaisesRegex(ValueError, "budget"):
                    tools.obtain(item, dest, [], True, [1])
            self.assertEqual(list(Path(temp).iterdir()), [])

    def test_archive_rejects_traversal_links_and_missing_executable(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "tool.tar.gz"
            item = {"format": "tar.gz", "strip_components": 1, "executable": "bin/tool"}
            for name, link in [("../escape", None), ("root/link", "../../escape"), ("root/other", None)]:
                with tarfile.open(path, "w:gz") as archive:
                    info = tarfile.TarInfo(name)
                    if link:
                        info.type = tarfile.SYMTYPE
                        info.linkname = link
                    archive.addfile(info)
                with self.subTest(name=name), self.assertRaises(ValueError):
                    tools.inspect_archive(path, item)
            with tarfile.open(path, "w:gz") as archive:
                info = tarfile.TarInfo("root/bin/tool")
                info.size = 2
                archive.addfile(info, io.BytesIO(b"ok"))
            self.assertEqual(tools.inspect_archive(path, item), 2)

    def test_offline_stage_is_byte_exact_and_never_fetches_chrome(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, dest, cache = root / "source", root / "output", root / "cache"
            target = "x86_64-unknown-linux-gnu"
            (source / target).mkdir(parents=True)
            (source / "licenses").mkdir()
            cache.mkdir()
            (cache / "tool").write_bytes(b"native")
            checksum = tools.digest(cache / "tool")
            entries = [dict(id=id, version="1", archive="payloads/tool", sha256=checksum, format="raw", executable="tool", url="https://example.invalid/tool", license="MIT", strip_components=0) for id in sorted(tools.REQUIRED)]
            wheel = cache / "sample.whl"
            with zipfile.ZipFile(wheel, "w") as archive:
                archive.writestr("sample-1.dist-info/METADATA", "Name: sample\nVersion: 1\n")
            pin = dict(archive="documents/wheels/sample.whl", sha256=tools.digest(wheel), name="sample", version="1", url="https://example.invalid/sample.whl", license="MIT")
            manifest = dict(schema=1, target=target, entries=entries, documents=dict(python="3.13", requirements="documents-requirements.txt", wheels=[pin]))
            raw = json.dumps(manifest, indent=4).encode()
            (source / target / "manifest.json").write_bytes(raw)
            navigation = dict(schema=1, target=target, entry=dict(id="browser-navigation", format="zip", strip_components=0,
                              bytes=8, sha256=checksum, url="https://example.invalid/chrome", archive="chrome.zip", executable="chrome/browser"))
            (source / target / "browser-navigation.json").write_text(json.dumps(navigation))
            (source / target / "documents-requirements.txt").write_text(f'sample==1 --hash=sha256:{pin["sha256"]}\n')
            manifest["documents"]["requirements_sha256"] = tools.digest(source / target / "documents-requirements.txt")
            raw = json.dumps(manifest, indent=4).encode()
            (source / target / "manifest.json").write_bytes(raw)
            args = argparse.Namespace(output=dest, command="prepare", cache=[cache], download=False)
            with patch.object(tools, "RESOURCES", source), patch.object(tools.urllib.request, "urlopen") as fetch:
                first = tools.prepare(args, target, [0])
                second = tools.prepare(args, target, [0])
                fetch.assert_not_called()
                (dest / target / "chrome.zip").write_bytes(b"forbidden")
                args.command = "verify"
                with self.assertRaisesRegex(ValueError, "Unexpected resource"):
                    tools.prepare(args, target, [0])
                (dest / target / "chrome.zip").unlink()
                self.assertFalse((dest / target / "build-report.json").exists())
                (dest / target / "build-report.json").write_text("{}")
                with self.assertRaisesRegex(ValueError, "Unexpected resource"):
                    tools.prepare(args, target, [0])
                (dest / target / "build-report.json").unlink()
            self.assertTrue(first["complete"])
            self.assertEqual(first, second)
            self.assertEqual((dest / target / "manifest.json").read_bytes(), raw)
            self.assertFalse(list((dest / target).rglob("chrome*.zip")))


if __name__ == "__main__":
    unittest.main()
