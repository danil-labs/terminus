#!/usr/bin/env python3
"""Ejecuta el motor y las herramientas del paquete con datos desechables y sin Node."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import tempfile
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--resources", type=Path, required=True)
    parser.add_argument("--browser", action="store_true")
    parser.add_argument("--clone", action="store_true")
    parser.add_argument("--architecture", choices=["arm64", "x86_64"])
    args = parser.parse_args()
    if args.architecture and platform.system() != "Darwin":
        parser.error("--architecture requires macOS")
    engine, resources = args.engine.resolve(strict=True), args.resources.resolve(strict=True)
    spec = importlib.util.spec_from_file_location("smoke", Path(__file__).with_name("work-tools-smoke.py"))
    smoke = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(smoke)
    with tempfile.TemporaryDirectory(prefix="terminus-package-smoke-") as temporary:
        lab = Path(temporary)
        home, data = lab / "home", lab / "data"
        home.mkdir()
        env = {key: os.environ[key] for key in ("SystemRoot", "COMSPEC", "PATHEXT") if key in os.environ}
        env.update(HOME=str(home), USERPROFILE=str(home), TMP=str(lab), TEMP=str(lab), TMPDIR=str(lab),
                   PATH=str(Path(os.environ["SystemRoot"]) / "System32") if os.name == "nt" else "/usr/bin:/bin",
                   XDG_CONFIG_HOME=str(home / "config"), XDG_DATA_HOME=str(home / "share"),
                   HARNESS_IGNORE_SYSTEM_GIT="1", HARNESS_IGNORE_SYSTEM_AGENTS="1", SELDON_PROJECTS_DIR=str(lab / "projects"))
        log = (lab / "engine.log").open("wb")
        prefix = ["/usr/bin/arch", "-" + args.architecture] if args.architecture else []
        process = subprocess.Popen(prefix + [str(engine), "--data-dir", str(data), "--resource-dir", str(resources),
                                    "--identity", "ai.danil.seldon.dev"], env=env, stdout=log, stderr=log)
        try:
            endpoint = None
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError((lab / "engine.log").read_text(errors="replace")[-6000:])
                path = data / "seldon-endpoint.json"
                if path.exists():
                    endpoint = json.loads(path.read_text())
                    if endpoint["pid"] == process.pid:
                        break
                time.sleep(.1)
            if not endpoint or endpoint["pid"] != process.pid:
                raise RuntimeError("Packaged engine did not start")

            def invoke(command, arguments=None, workspace=None):
                key = str(uuid.uuid4())
                timeout = 900 if command == "install_tool" and (arguments or {}).get("tool") == "browser-navigation" else 180
                deadline = time.monotonic() + max(600, timeout)
                while time.monotonic() < deadline:
                    request = {"version": 1, "token": Path(endpoint["token_file"]).read_text(),
                               "command": "service invoke", "args": {"command": command, "arguments": arguments or {}},
                               "workspace": workspace, "folder": None, "request_id": key}
                    address, port = endpoint["address"].rsplit(":", 1)
                    with socket.create_connection((address, int(port)), timeout=timeout) as connection:
                        connection.sendall(json.dumps(request).encode() + b"\n")
                        reply = json.loads(connection.makefile("rb").readline(16 * 1024 * 1024))
                    if reply.get("error"):
                        raise RuntimeError(reply)
                    result = reply["result"]
                    if result.get("pending"):
                        time.sleep(.1)
                        continue
                    if result.get("error"):
                        raise RuntimeError(result)
                    return result.get("value")
                raise TimeoutError(command)

            workspace = invoke("add_workspace", {"name": "Package smoke"})["id"]
            invoke("install_tool", {"tool": "bundled-work-tools"}, workspace)
            report = invoke("check_environment", {"force": True}, workspace)
            if not report["ready"] or {"node", "npm"}.intersection(report["essential"]):
                raise RuntimeError("Packaged tools did not prepare independently of Node/npm")
            plugins = {item["id"]: item for item in invoke("list_integrations", {}, workspace)["plugins"]}
            if not plugins["computer-use"]["installed"] or plugins["computer-use"]["enabled"]:
                raise RuntimeError("Cua must be installed and initially inactive")
            if not plugins["drawio"]["installed"] or not plugins["drawio"]["enabled"]:
                raise RuntimeError("draw.io must be available")
            store = data / "entorno/work-tools"
            selection = json.loads((store / "active.json").read_text())
            snapshot = store / "versions" / selection["snapshot"]
            binaries = snapshot / ("python" if os.name == "nt" else "python/bin")
            document_env = dict(env, PATH=str(binaries))
            for alias in ("python", "python3"):
                executable = binaries / (alias + (".exe" if os.name == "nt" else ""))
                subprocess.run([str(executable), "-I", "-c", smoke.DOCUMENT_PROBE, str(lab)],
                               env=document_env, check=True, timeout=60)
            if (store / "browser-navigation/active.json").exists():
                raise RuntimeError("Core preparation must not activate Chrome")
            if args.clone:
                operation = str(uuid.uuid4())
                (lab / "clones").mkdir()
                invoke("start_project_clone", {"url": "https://github.com/octocat/Hello-World.git", "name": "Public clone",
                       "directory": str(lab / "clones"), "operation": operation, "workspace": workspace}, workspace)
                deadline = time.monotonic() + 120
                cloned = None
                while time.monotonic() < deadline:
                    cloned = invoke("project_clone_status", {"operation": operation}, workspace)
                    if cloned and cloned.get("done"):
                        break
                    time.sleep(.2)
                if not cloned or not cloned.get("project") or cloned.get("error"):
                    raise RuntimeError(f"Packaged Git could not clone over HTTPS: {cloned}")
            if args.browser:
                invoke("install_tool", {"tool": "browser-navigation"}, workspace)
            print(json.dumps({"packaged_engine": str(engine), "documents": "round trips passed with both aliases",
                              "cua": "installed, inactive", "drawio": "installed, enabled",
                              "public_clone": "passed" if args.clone else "not requested",
                              "browser": "explicit activation and sandboxed launch passed" if args.browser else "not activated"}))
        finally:
            process.terminate()
            try:
                process.wait(20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            log.close()


if __name__ == "__main__":
    main()
