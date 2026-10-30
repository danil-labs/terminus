import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function fixture(t, publishedTarget) {
  const root = mkdtempSync(join(tmpdir(), "candidate-pin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["scripts", "src-tauri/crates/engine-protocol", "prepared/native"]) mkdirSync(join(root, directory), { recursive: true });
  for (const script of ["work-tools-candidate.mjs", "work-tools-candidate-verify.py", "work-tools.py"]) copyFileSync(join(desktop, "scripts", script), join(root, "scripts", script));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));
  const contract = join(root, "src-tauri/crates/engine-protocol/commands.json");
  writeFileSync(contract, "{}");
  const engine = join(root, "engine");
  writeFileSync(engine, `#!${process.execPath}\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst data = process.argv[process.argv.indexOf('--data-dir') + 1];\nfs.mkdirSync(data, { recursive: true });\nfs.writeFileSync(path.join(data, 'seldon-endpoint.json'), JSON.stringify({ pid: process.pid, contract: '${digest(contract)}' }));\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
  writeFileSync(join(root, "seldon-runtime.lock"), JSON.stringify({ release: "fixture-release", platforms: { [publishedTarget]: { sha256: digest(engine) } } }));
  const resources = join(root, "prepared/native");
  writeFileSync(join(resources, "inventory.json"), "{}");
  writeFileSync(join(resources, "browser-navigation.json"), "{}");
  writeFileSync(join(resources, "manifest.json"), JSON.stringify({ schema: 2, layout: "tree", target: "x86_64-unknown-linux-gnu", inventory_sha256: digest(join(resources, "inventory.json")) }));
  writeFileSync(join(root, "prepared/resources-inventory.json"), "{}");
  const run = () => spawnSync(process.execPath, [join(root, "scripts/work-tools-candidate.mjs"), "--version", "9.9.9", "--engine", engine, "--engine-sha256", digest(engine), "--resources", resources, "--manifest-sha256", digest(join(resources, "manifest.json")), "--patchelf", "/usr/bin/true"], { encoding: "utf8", timeout: 10_000 });
  return { root, run };
}

test("candidate accepts the native published pin and reports its provenance", { skip: process.platform !== "linux" || process.arch !== "x64" }, (t) => {
  const { root, run } = fixture(t, "x86_64-unknown-linux-gnu");
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const metadata = JSON.parse(readFileSync(output.metadata, "utf8"));
  assert.equal(metadata.published_engine_lock, true);
  assert.equal(metadata.source_engine, "fixture-release");
  assert.equal(metadata.updater_signature, false);
  const config = JSON.parse(readFileSync(output.config, "utf8"));
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  const probe = join(root, "appimage-probe");
  writeFileSync(probe, "#!/bin/sh\nexit 73\n", { mode: 0o755 });
  const verify = () => spawnSync("python3", [join(root, "scripts/work-tools-candidate-verify.py"), "--candidate", output.metadata, "--appimage", probe, "--patchelf", "/usr/bin/true"], { encoding: "utf8", timeout: 10_000 });
  // La sonda detiene la extracción: acredita la frontera del pin sin construir un instalador.
  assert.match(verify().stderr, /exit status 73/);
  metadata.published_engine_lock = false;
  writeFileSync(output.metadata, JSON.stringify(metadata));
  assert.match(verify().stderr, /metadata disagrees/);
});

test("candidate rejects a published pin for another architecture", { skip: process.platform !== "linux" || process.arch !== "x64" }, (t) => {
  const { run } = fixture(t, "aarch64-apple-darwin");
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match the native target/);
});

test("candidate rejects a native pin whose engine contract differs from the window", { skip: process.platform !== "linux" || process.arch !== "x64" }, (t) => {
  const { root, run } = fixture(t, "x86_64-unknown-linux-gnu");
  writeFileSync(join(root, "src-tauri/crates/engine-protocol/commands.json"), '{"changed":true}');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /engine contract does not match the window/);
});

test("candidate still accepts a local engine with exact hash and contract", { skip: process.platform !== "linux" || process.arch !== "x64" }, (t) => {
  const { root, run } = fixture(t, "unused");
  writeFileSync(join(root, "seldon-runtime.lock"), JSON.stringify({ platforms: {} }));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(readFileSync(JSON.parse(result.stdout).metadata, "utf8"));
  assert.equal(metadata.published_engine_lock, false);
});
