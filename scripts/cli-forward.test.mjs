import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../src-tauri/src/cli.rs", import.meta.url));

test("el despacho conserva las entradas de ventana e instalador", () => {
  const scratch = mkdtempSync(join(tmpdir(), "terminus-cli-"));
  try {
    const binary = join(scratch, process.platform === "win32" ? "tests.exe" : "tests");
    execFileSync("rustc", ["--edition=2021", "--test", source, "-o", binary], { timeout: 60_000 });
    execFileSync(binary, [], { timeout: 10_000 });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("Unix reenvía argumentos, stdin, stdout, stderr y salida sin esperar una ventana", {
  skip: process.platform === "win32" ? "exec solo existe en Unix" : false,
}, () => {
  const scratch = mkdtempSync(join(tmpdir(), "terminus-cli-"));
  try {
    const main = join(scratch, "main.rs");
    const binary = join(scratch, "terminus");
    writeFileSync(main, `#[path = ${JSON.stringify(source)}] mod cli;
fn main() {
    if cli::requested(std::env::args_os().nth(1).as_deref()) {
        eprintln!("{:?}", cli::forward());
        std::process::exit(1);
    }
    println!("window");
}`);
    execFileSync("rustc", ["--edition=2021", main, "-o", binary], { timeout: 60_000 });
    const engine = join(scratch, "seldon-runtime");
    writeFileSync(engine, '#!/bin/sh\nprintf "%s\\n" "$@"\ncat\nprintf "engine stderr\\n" >&2\nexit 23\n');
    chmodSync(engine, 0o700);
    const result = spawnSync(binary, ["task", "á con espacios", "--json"], {
      input: "entrada\n", encoding: "utf8", timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 23);
    assert.equal(result.stdout, "task\ná con espacios\n--json\nentrada\n");
    assert.equal(result.stderr, "engine stderr\n");
    const discarded = spawnSync(binary, ["instances", "--json"], { stdio: "ignore", timeout: 10_000 });
    assert.ifError(discarded.error);
    assert.equal(discarded.status, 23);
    rmSync(engine);
    const missing = spawnSync(binary, ["task"], { encoding: "utf8", timeout: 10_000 });
    assert.ifError(missing.error);
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    assert.ok(missing.stderr.length > 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
