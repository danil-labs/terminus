#!/usr/bin/env python3
"""Exercise a staged Linux payload offline in disposable directories.

Usage: python3 scripts/work-tools-smoke.py resources/work-tools/x86_64-unknown-linux-gnu
Requires ~450 MiB temporary disk space. Runs no Cua process and no browser install.
This checks tools/document round trips, not native window or browser navigation QA.
"""

import importlib.util
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
import tempfile
import zipfile


spec = importlib.util.spec_from_file_location("work_tools", Path(__file__).with_name("work-tools.py"))
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)


DOCUMENT_PROBE = """
import io,json,sys,importlib.metadata
from pathlib import Path
from openpyxl import Workbook,load_workbook
from docx import Document
from pptx import Presentation
from pypdf import PdfReader
from PIL import Image
from reportlab.pdfgen.canvas import Canvas
root=Path(sys.argv[1])
book=Workbook();book.active['A1']='Terminus';book.save(root/'sample.xlsx')
assert load_workbook(root/'sample.xlsx').active['A1'].value=='Terminus'
doc=Document();doc.add_paragraph('Terminus');doc.save(root/'sample.docx')
assert Document(root/'sample.docx').paragraphs[0].text=='Terminus'
slides=Presentation();slide=slides.slides.add_slide(slides.slide_layouts[0]);slide.shapes.title.text='Terminus';slides.save(root/'sample.pptx')
assert Presentation(root/'sample.pptx').slides[0].shapes.title.text=='Terminus'
pdf=Canvas(str(root/'sample.pdf'));pdf.drawString(72,720,'Terminus');pdf.save()
assert 'Terminus' in PdfReader(root/'sample.pdf').pages[0].extract_text()
Image.new('RGB',(16,16),'red').save(root/'sample.png')
with Image.open(root/'sample.png') as image: assert image.size==(16,16)
print(json.dumps({'python':sys.version.split()[0],'round_trips':['xlsx','docx','pptx','pdf','png'],'distributions':{d.metadata['Name']:d.version for d in importlib.metadata.distributions()}}))
"""


def main():
    if len(sys.argv) != 2 or platform.system() != "Linux" or platform.machine() != "x86_64":
        raise ValueError("This native smoke test requires Linux x86_64 and one staged directory")
    source = Path(sys.argv[1]).resolve()
    manifest = tools.load_manifest(source, "x86_64-unknown-linux-gnu")
    tools.verify_documents(source, manifest)
    entries = {entry["id"]: entry for entry in manifest["entries"]}
    with tempfile.TemporaryDirectory(prefix="terminus-tools-smoke-") as temp:
        root = Path(temp)
        paths = {}
        for id in ["git", "python", "uv", "ripgrep", "agent-browser"]:
            entry = entries[id]
            archive = tools.child(source, entry["archive"])
            if tools.digest(archive) != entry["sha256"]:
                raise ValueError(f"Checksum mismatch: {id}")
            tools.inspect_archive(archive, entry)
            destination = root / id
            destination.mkdir()
            if entry["format"] == "raw":
                paths[id] = destination / entry["executable"]
                paths[id].write_bytes(archive.read_bytes())
                paths[id].chmod(0o755)
            else:
                if entry["format"] == "zip":
                    with zipfile.ZipFile(archive) as package:
                        package.extractall(destination)
                else:
                    with tarfile.open(archive) as tar:
                        tar.extractall(destination, filter="data")
                strip = entry.get("strip_components", 0)
                prefix = destination
                for _ in range(strip):
                    children = list(prefix.iterdir())
                    if len(children) != 1 or not children[0].is_dir():
                        raise ValueError(f"Expected a single archive root: {id}")
                    prefix = children[0]
                paths[id] = prefix / entry["executable"]
                paths[id].chmod(0o755)
        env = {"HOME": str(root), "PATH": "", "LANG": "C.UTF-8", "UV_CACHE_DIR": str(root / "uv-cache"),
               "UV_PYTHON_DOWNLOADS": "never", "UV_OFFLINE": "1", "GIT_CONFIG_NOSYSTEM": "1",
               "GIT_CONFIG_GLOBAL": os.devnull}
        def run(command, cwd=root):
            result = subprocess.run([str(arg) for arg in command], cwd=cwd, env=env, text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=True)
            return result.stdout.strip()
        versions = {id: run([path, "--version"]) for id, path in paths.items()}
        repo = root / "repo"
        run([paths["git"], "init", repo])
        (repo / "file.txt").write_text("Terminus offline\n")
        run([paths["git"], "add", "file.txt"], repo)
        run([paths["git"], "-c", "user.name=Terminus smoke", "-c", "user.email=smoke@example.invalid", "commit", "-m", "smoke"], repo)
        assert run([paths["git"], "show", "HEAD:file.txt"], repo) == "Terminus offline"
        assert "Terminus offline" in run([paths["ripgrep"], "Terminus", repo])
        venv = root / "documents"
        run([paths["uv"], "venv", "--python", paths["python"], venv])
        python = venv / "bin/python"
        run([paths["uv"], "pip", "install", "--python", python, "--offline", "--no-index", "--require-hashes",
             "--find-links", source / "documents/wheels", "-r", source / manifest["documents"]["requirements"]])
        report = json.loads(run([python, "-I", "-c", DOCUMENT_PROBE, root]))
        # Both names must select the private document environment.
        assert run([venv / "bin/python3", "-I", "-c", "import openpyxl;print(openpyxl.__version__)"]) == report["distributions"]["openpyxl"]
        report.update(target=manifest["target"], versions=versions, git_commit=True, ripgrep_search=True,
                      python_aliases=["python", "python3"], browser_scope="version only; Chrome absent", cua_scope="not launched")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError, AssertionError) as error:
        print(f"work-tools-smoke: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError):
            print(error.stderr, file=sys.stderr)
        sys.exit(1)
