import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "terminus-version-"));
  for (const path of ["scripts", "src-tauri/src", "src-tauri/sentinel/src", "bin"]) mkdirSync(join(root, path), { recursive: true });
  for (const script of ["version.mjs", "release-version.mjs", "work-tools-candidate.mjs"]) {
    cpSync(new URL(`../../scripts/${script}`, import.meta.url), join(root, "scripts", script));
  }
  writeFileSync(join(root, "package.json"), '{"type":"module",\n"version": "0.2.89"\n}\n');
  writeFileSync(join(root, "src-tauri/tauri.conf.json"), '{\n"version": "0.2.89",\n"identifier":"ai.danil.terminus"\n}\n');
  writeFileSync(join(root, "src-tauri/Cargo.toml"), '[package]\nname = "terminus"\nversion = "0.2.89"\nedition = "2021"\n[dependencies]\nsentinel = { path = "sentinel" }\n');
  writeFileSync(join(root, "src-tauri/src/main.rs"), 'fn main() {}\n');
  writeFileSync(join(root, "src-tauri/sentinel/Cargo.toml"), '[package]\nname = "sentinel"\nversion = "0.2.89"\nedition = "2021"\n');
  writeFileSync(join(root, "src-tauri/sentinel/src/lib.rs"), 'pub fn sentinel() {}\n');
  writeFileSync(join(root, "bin/pnpm"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$QA_COMMAND_LOG"\nexit "${QA_VERIFY_EXIT:-0}"\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, CARGO_TARGET_DIR: join(root, "target"), QA_COMMAND_LOG: join(root, "commands.log") };
  execFileSync("cargo", ["generate-lockfile", "--offline"], { cwd: join(root, "src-tauri"), env, stdio: "pipe" });
  return { root, env, run: (...args) => spawnSync(process.execPath, [join(root, "scripts/version.mjs"), ...args], { env, encoding: "utf8" }) };
}

function versions(root, expected) {
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).version, expected);
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json")));
  assert.equal(tauri.version, expected);
  assert.equal(tauri.identifier, "ai.danil.terminus");
  assert.match(readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8"), new RegExp(`version = "${expected.replaceAll(".", "\\.")}"`));
  const lock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");
  assert.ok(lock.includes(`name = "terminus"\nversion = "${expected}"`));
  assert.ok(lock.includes('name = "sentinel"\nversion = "0.2.89"'));
}

test("prepares rc, subsequent rc and stable without compiling or verifying", () => {
  const f = fixture();
  try {
    for (const version of ["0.3.0-rc.1", "0.3.0-rc.2", "0.3.0"]) {
      const result = f.run(version, "--prepare-only");
      assert.equal(result.status, 0, result.stderr);
      versions(f.root, version);
      assert.match(result.stdout, /quedan pendientes/);
    }
    assert.throws(() => readFileSync(join(f.root, "commands.log")), { code: "ENOENT" });
    assert.throws(() => readFileSync(join(f.root, "target/debug/terminus")), { code: "ENOENT" });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("rejects invalid prereleases, unknown options and the current version without editing", () => {
  const f = fixture();
  try {
    for (const args of [["01.3.0"], ["0.3.0-rc.01"], ["0.3.0-"], ["0.3.0+build"], ["0.3.0", "--skip"], ["0.2.89"]]) {
      assert.equal(f.run(...args).status, 1);
      versions(f.root, "0.2.89");
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("normal bump runs verify and retains the prepared version when verify fails", () => {
  const f = fixture();
  try {
    f.env.QA_VERIFY_EXIT = "7";
    const result = f.run("0.3.0-rc.1");
    assert.equal(result.status, 1);
    assert.equal(readFileSync(join(f.root, "commands.log"), "utf8"), "verify\n");
    versions(f.root, "0.3.0-rc.1");
    assert.match(result.stderr, /no pasó/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("candidate helper accepts the prepared rc version and keeps the next validation gate", () => {
  const f = fixture();
  try {
    assert.equal(f.run("0.3.0-rc.1", "--prepare-only").status, 0);
    const result = spawnSync(process.execPath, [join(f.root, "scripts/work-tools-candidate.mjs"), "--version", "0.3.0-rc.1"], { env: f.env, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing --engine/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
