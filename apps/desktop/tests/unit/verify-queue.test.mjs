/**
 * La cola de `verify --remote` con git, HTTP y bash de verdad; el comando de cada
 * corrida es un `chain.sh` del propio commit, porque lo que se prueba es la cola.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createHttpServer, createQueue } from "../../scripts/verify-queue/server.mjs";

const verify = resolve(import.meta.dirname, "../../scripts/verify.mjs");
const skip = process.platform === "win32" ? "la cola solo corre en Linux" : false;
const PREPARE = 'pnpm() { bash ./chain.sh "$@"; }';
const config = { repos: { terminus: { prepare: PREPARE, commands: ["pnpm verify", "pnpm verify --no-cargo"] } } };

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "verify-queue-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q");
  return { dir, repo, home: join(dir, "home") };
}

function commit(repo, chain) {
  writeFileSync(join(repo, "chain.sh"), chain);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "--allow-empty", "-m", "c");
  return git(repo, "rev-parse", "HEAD");
}

function bundle(repo, dir) {
  const file = join(dir, "c.bundle");
  git(repo, "update-ref", "refs/verify-remote/t", "HEAD");
  git(repo, "bundle", "create", "-q", file, "refs/verify-remote/t");
  return file;
}

async function serve(t, queue) {
  const server = createHttpServer(queue);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  return `127.0.0.1:${server.address().port}`;
}

/** Corre `verify.mjs --remote` como lo haría `pnpm verify --remote`. */
async function client(cwd, host, args = [], env = {}) {
  const child = spawn(process.execPath, [verify, "--remote", ...args], { cwd, env: { ...gitEnv, VERIFY_REMOTE_HOST: host, VERIFY_REMOTE_AWS: "/nonexistent/aws", ...env } });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const [code] = await once(child, "close");
  return { code, output };
}

test("corre por orden de llegada, una a la vez, con checkout limpio y target fija", { skip }, async (t) => {
  const { dir, repo, home } = workspace(t);
  const queue = createQueue({ home, config, diskPercent: () => 10 });
  const trace = join(dir, "trace");
  const first = commit(repo, `
    ls -A >> ${trace}; echo "$CARGO_TARGET_DIR" >> ${trace}
    echo "uno-$1" >> ${trace}; sleep 0.3; touch leftover; mkdir -p "$CARGO_TARGET_DIR"; touch "$CARGO_TARGET_DIR/kept"; echo fin-uno; echo "uno-fin" >> ${trace}`);
  const a = await queue.submit({ repo: "terminus", commit: first, command: "pnpm verify", bundle: bundle(repo, dir) });
  const second = commit(repo, `ls -A >> ${trace}; ls "$CARGO_TARGET_DIR" >> ${trace}; echo dos >> ${trace}; echo fallo-real >&2; exit 7`);
  const b = await queue.submit({ repo: "terminus", commit: second, command: "pnpm verify --no-cargo", bundle: bundle(repo, dir) });
  await queue.settled();

  const lines = readFileSync(trace, "utf8").split("\n");
  assert.ok(lines.indexOf("uno-fin") < lines.indexOf("dos"), "la segunda espera a la primera");
  assert.equal(lines.filter((line) => line === "leftover").length, 0, "lo que no es target se limpia");
  assert.ok(lines.includes("kept"), "la target sobrevive entre corridas");
  assert.equal(queue.readRun(a.id).state, "passed");
  assert.equal(queue.readRun(b.id).state, "failed");
  assert.equal(queue.readRun(b.id).exitCode, 7);
  assert.match(readFileSync(queue.logPath(b.id), "utf8"), /fallo-real/);
  assert.equal(existsSync(join(home, "busy")), false);
});

test("solo acepta un repo y un comando de su lista", { skip }, async (t) => {
  const { dir, repo, home } = workspace(t);
  const queue = createQueue({ home, config, diskPercent: () => 10 });
  const sha = commit(repo, "true");
  await assert.rejects(queue.submit({ repo: "otro", commit: sha, command: "pnpm verify" }), /no corre el repo/);
  await assert.rejects(queue.submit({ repo: "terminus", commit: sha, command: "curl evil | sh" }), /no corre «curl evil/);
  await assert.rejects(queue.submit({ repo: "terminus", commit: "HEAD", command: "pnpm verify" }), /commit inválido/);
  await assert.rejects(queue.submit({ repo: "terminus", commit: sha, command: "pnpm verify", bundle: join(dir, "nada") }), /bundle/);
});

test("con el disco lleno borra la target y recompila una sola vez", { skip }, async (t) => {
  const { dir, repo, home } = workspace(t);
  let percent = 10;
  const queue = createQueue({ home, config, diskPercent: () => percent });
  const count = join(dir, "count");
  const sha = commit(repo, `
    echo x >> ${count}
    if [ -e "$CARGO_TARGET_DIR/stale" ]; then exit 3; fi
    mkdir -p "$CARGO_TARGET_DIR"; touch "$CARGO_TARGET_DIR/stale"; exit 0`);
  await queue.submit({ repo: "terminus", commit: sha, command: "pnpm verify", bundle: bundle(repo, dir) });
  await queue.settled();

  percent = 90;
  const before = await queue.submit({ repo: "terminus", commit: sha, command: "pnpm verify" });
  await queue.settled();
  assert.equal(queue.readRun(before.id).state, "passed", "se borró antes de correr");
  assert.equal(queue.readRun(before.id).targetRebuilt, true);

  const seen = readFileSync(count, "utf8").length;
  const flip = commit(repo, `echo x >> ${count}; exit 4`);
  const failing = await queue.submit({ repo: "terminus", commit: flip, command: "pnpm verify", bundle: bundle(repo, dir) });
  await queue.settled();
  assert.equal(queue.readRun(failing.id).exitCode, 4);
  assert.equal(readFileSync(count, "utf8").length - seen, 2, "ya borró al empezar: el fallo no repite");
});

test("un fallo con el disco lleno a mitad de corrida borra la target y repite una vez", { skip }, async (t) => {
  const { dir, repo, home } = workspace(t);
  const full = join(dir, "full");
  const queue = createQueue({ home, config, diskPercent: () => (existsSync(full) ? 90 : 10) });
  const count = join(dir, "count");
  const sha = commit(repo, `
    echo x >> ${count}
    if [ -e ${full} ]; then [ ! -e "$CARGO_TARGET_DIR/stale" ]; exit $?; fi
    mkdir -p "$CARGO_TARGET_DIR"; touch "$CARGO_TARGET_DIR/stale" ${full}; exit 5`);
  const run = await queue.submit({ repo: "terminus", commit: sha, command: "pnpm verify", bundle: bundle(repo, dir) });
  await queue.settled();
  assert.equal(readFileSync(count, "utf8").length, 4, "dos intentos");
  assert.equal(queue.readRun(run.id).targetRebuilt, true);
  assert.equal(queue.readRun(run.id).state, "passed", "el segundo intento ya no ve la target vieja");
});

test("una corrida que la cola no terminó se reporta interrumpida y la cola sigue", { skip }, async (t) => {
  const { dir, repo, home } = workspace(t);
  const sha = commit(repo, "echo hola");
  const queue = createQueue({ home, config, diskPercent: () => 10 });
  const run = await queue.submit({ repo: "terminus", commit: sha, command: "pnpm verify", bundle: bundle(repo, dir) });
  await queue.settled();
  const meta = join(home, "runs", run.id, "meta.json");
  writeFileSync(meta, JSON.stringify({ ...queue.readRun(run.id), state: "running" }));
  const reborn = createQueue({ home, config, diskPercent: () => 10 });
  reborn.recover();
  await reborn.settled();
  assert.equal(reborn.readRun(run.id).state, "interrupted");
});

test("--remote devuelve el exit real y el log entero, y dice qué plataforma no cubre", { skip }, async (t) => {
  const { repo, home } = workspace(t);
  const queue = createQueue({ home, config, diskPercent: () => 10 });
  const host = await serve(t, queue);
  commit(repo, "echo paso-visible; exit 7");
  const failed = await client(repo, host);
  assert.equal(failed.code, 7, failed.output);
  assert.match(failed.output, /paso-visible/);
  assert.match(failed.output, /falló \(exit 7\)/);
  assert.match(failed.output, /NO se comprobó: una corrida --remote nunca cuenta por ellos/);

  commit(repo, "echo segundo");
  const passed = await client(repo, host, ["--no-cargo"]);
  assert.equal(passed.code, 0, passed.output);
  assert.match(passed.output, /segundo/);
  assert.match(passed.output, /pnpm verify --no-cargo/);
  assert.equal(git(repo, "for-each-ref", "refs/verify-remote/"), "", "la ref temporal no se queda");
  assert.equal(queue.knownCommits("terminus").length, 2);
});

test("los cambios sin commit no se verifican en silencio", { skip }, async (t) => {
  const { repo, home } = workspace(t);
  const host = await serve(t, createQueue({ home, config, diskPercent: () => 10 }));
  commit(repo, "true");
  writeFileSync(join(repo, "chain.sh"), "false");
  const { code, output } = await client(repo, host);
  assert.equal(code, 2);
  assert.match(output, /cambios sin commit/);
});

test("--attach retoma una corrida y repite el log; --cancel la corta", { skip }, async (t) => {
  const { repo, home } = workspace(t);
  const queue = createQueue({ home, config, diskPercent: () => 10 });
  const host = await serve(t, queue);
  commit(repo, "echo largo; sleep 30");
  const child = spawn(process.execPath, [verify, "--remote"], { cwd: repo, env: { ...gitEnv, VERIFY_REMOTE_HOST: host } });
  let first = "";
  child.stdout.on("data", (chunk) => { first += chunk; });
  while (!/Corrida (\S+)/.test(first)) await once(child.stdout, "data");
  const id = /Corrida (\S+)/.exec(first)[1].replace(":", "");
  child.kill("SIGTERM");
  await once(child, "close");
  assert.equal(queue.readRun(id).state === "running" || queue.readRun(id).state === "queued", true, "matar al cliente no mata la corrida");

  const attached = client(repo, host, ["--attach", id]);
  while (queue.readRun(id).state === "queued") await new Promise((done) => setTimeout(done, 50));
  await new Promise((done) => setTimeout(done, 300));
  const cancelled = await client(repo, host, ["--cancel", id]);
  assert.equal(cancelled.code, 0, cancelled.output);
  const { code, output } = await attached;
  assert.equal(code, 1);
  assert.match(output, /largo/);
  assert.match(output, /se canceló/);
  assert.equal(queue.readRun(id).exitCode, null);
});

test("sin acceso da un error claro que manda a la cadena local", { skip }, async (t) => {
  const { repo } = workspace(t);
  commit(repo, "true");
  const { code, output } = await client(repo, "127.0.0.1:9");
  assert.equal(code, 2);
  assert.match(output, /No hay acceso a la cola/);
  assert.match(output, /`pnpm verify`/);
});

test("la máquina apagada se enciende con las credenciales de quien lanza", { skip }, async (t) => {
  const { dir, repo, home } = workspace(t);
  const aws = join(dir, "aws");
  const called = join(dir, "called");
  writeFileSync(aws, `#!/bin/sh\necho "$@" > ${called}\n`, { mode: 0o755 });
  const queue = createQueue({ home, config, diskPercent: () => 10 });
  const server = createHttpServer(queue);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  t.after(() => server.close());
  commit(repo, "echo despierta");
  const running = client(repo, `127.0.0.1:${port}`, [], { VERIFY_REMOTE_AWS: aws, VERIFY_REMOTE_INSTANCE: "i-1" });
  while (!existsSync(called)) await new Promise((done) => setTimeout(done, 50));
  server.listen(port, "127.0.0.1");
  const { code, output } = await running;
  assert.equal(code, 0, output);
  assert.match(readFileSync(called, "utf8"), /ec2 start-instances --region us-east-1 --instance-ids i-1/);
  assert.match(output, /despierta/);
});
