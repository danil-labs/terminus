import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const main = process.env.TERMINUS_CLI_TEST_MAIN ?? fileURLToPath(new URL("../src-tauri/src/main.rs", import.meta.url));
const windows = process.platform === "win32";

test("el main de producción reenvía la CLI con pipes, archivos, salida descartada y sin consola nueva", () => {
  const scratch = mkdtempSync(join(tmpdir(), "terminus-forward-"));
  const binary = join(scratch, windows ? "terminus.exe" : "terminus");
  const engine = join(scratch, windows ? "seldon-runtime.exe" : "seldon-runtime");
  const run = (args, options = {}) => {
    const result = spawnSync(binary, args, { encoding: "utf8", timeout: 10_000, windowsHide: true, ...options });
    assert.ifError(result.error);
    return result;
  };
  try {
    const stub = join(scratch, "app_lib.rs");
    const library = join(scratch, "libapp_lib.rlib");
    writeFileSync(stub, `pub struct Error { pub message_key: &'static str }
pub fn launch() -> Result<(), Error> { println!("window"); Ok(()) }
pub fn stop_engine() -> i32 { println!("stop-engine"); 0 }
`);
    execFileSync("rustc", ["--edition=2021", "--crate-name", "app_lib", "--crate-type=rlib", stub, "-o", library], { timeout: 60_000 });
    execFileSync("rustc", ["--edition=2021", "-C", "debug-assertions=no", main, "--extern", `app_lib=${library}`, "-o", binary], { timeout: 60_000 });
    const fixture = join(scratch, "engine.rs");
    writeFileSync(fixture, `use std::io::{Read, Write};
#[cfg(windows)]
fn check_console() {
    #[link(name="kernel32")] extern "system" { fn GetConsoleWindow() -> *mut std::ffi::c_void; }
    if !unsafe { GetConsoleWindow() }.is_null() { eprintln!("unexpected console"); std::process::exit(99); }
}
fn main() {
    #[cfg(windows)] check_console();
    let args: Vec<_> = std::env::args().skip(1).collect();
    for arg in &args { println!("{arg}"); }
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).expect("stdin");
    print!("{input}");
    if args.iter().any(|arg| arg == "--stream") {
        std::io::stdout().write_all(&vec![b'x'; 256 * 1024]).expect("stdout");
        std::io::stderr().write_all(&vec![b'y'; 256 * 1024]).expect("stderr");
    }
    eprintln!("engine stderr");
    std::process::exit(23);
}
`);
    execFileSync("rustc", ["--edition=2021", fixture, "-o", engine], { timeout: 60_000 });

    if (windows) {
      const pe = readFileSync(binary);
      const optionalHeader = pe.readUInt32LE(0x3c) + 24;
      assert.equal(pe.readUInt16LE(optionalHeader + 68), 2, "el wrapper debe ser un PE de subsistema Windows");
    }

    const piped = run(["task", "á con espacios", "--json"], { input: "entrada\n" });
    assert.equal(piped.status, 23);
    assert.equal(piped.stdout, "task\ná con espacios\n--json\nentrada\n");
    assert.equal(piped.stderr, "engine stderr\n");

    const inputFile = join(scratch, "input.txt");
    const outputFile = join(scratch, "output.txt");
    const errorFile = join(scratch, "error.txt");
    writeFileSync(inputFile, "desde archivo\n");
    const descriptors = [openSync(inputFile, "r"), openSync(outputFile, "w"), openSync(errorFile, "w")];
    try {
      assert.equal(run(["instances", "--json"], { stdio: descriptors }).status, 23);
    } finally {
      for (const fd of descriptors) closeSync(fd);
    }
    assert.equal(readFileSync(outputFile, "utf8"), "instances\n--json\ndesde archivo\n");
    assert.equal(readFileSync(errorFile, "utf8"), "engine stderr\n");
    assert.equal(run(["instances", "--json"], { stdio: "ignore" }).status, 23);
    const streamed = run(["chat", "--stream"], { maxBuffer: 1024 * 1024 });
    assert.equal(streamed.status, 23);
    assert.equal(streamed.stdout, `chat\n--stream\n${"x".repeat(256 * 1024)}`);
    assert.equal(streamed.stderr, `${"y".repeat(256 * 1024)}engine stderr\n`);

    for (const args of [["--instance=123", "status"], ["--instance", "123", "status"], ["--json", "instances"], ["--help"], ["-h"], ["--version"], ["-V"], ["kn", "--help"]]) {
      const result = run(args);
      assert.equal(result.status, 23);
      assert.equal(result.stdout, `${args.join("\n")}\n`);
      assert.equal(result.stderr, "engine stderr\n");
    }
    for (const args of [[], ["--external-host", "selection.json"], ["-psn_0_123"],
      ["terminus://task?id=qa"], ["https://example.invalid/"], ["C:\\QA\\report.md"],
      ["/tmp/report.md"], ["report.md"], ["./task"], ["--updated"], ["/S"], ["/P"],
      ["/UPDATE"], ["/ARGS", "--external-host", "selection.json"], ["--", "status"], ["unknown"]]) {
      const result = run(args);
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "window\n", JSON.stringify(args));
      assert.equal(result.stderr, "");
    }
    const installer = run(["--stop-engine"]);
    assert.equal(installer.stdout, "stop-engine\n");
    assert.equal(installer.status, 0);

    rmSync(engine);
    const missing = run(["task"]);
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /^cli\.error\.engine_start_failed:/);
  } finally {
    const checked = resolve(scratch);
    assert.equal(dirname(checked), resolve(tmpdir()));
    assert.ok(relative(tmpdir(), checked).startsWith("terminus-forward-"));
    rmSync(checked, { recursive: true, force: true });
  }
});
