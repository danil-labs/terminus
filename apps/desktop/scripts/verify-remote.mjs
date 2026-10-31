/**
 * `pnpm verify --remote`: manda un commit a la cola de una máquina y sigue su corrida.
 *
 * El servidor es `verify-queue/server.mjs`. Lo que viaja es un commit, nunca el árbol
 * de trabajo, y la corrida sigue en la máquina aunque este proceso muera.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, openAsBlob, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const REPO = "terminus";
const DEFAULT_HOST = "terminus-verify-equipo:8787";
const DEFAULT_INSTANCE = "i-0af42d5cff6d4aa8a";
const DEFAULT_REGION = "us-east-1";
const COMMAND_TIMEOUT_MS = 60_000;
const BUNDLE_TIMEOUT_MS = 5 * 60_000;
const HEALTH_TIMEOUT_MS = 5_000;
const POLL_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const WAKE_TIMEOUT_MS = 4 * 60_000;
const LOST_AFTER_MS = 2 * 60_000;
const POLL_MS = 2_000;

class RemoteError extends Error {}

const accessHelp = (host) =>
  `No hay acceso a la cola en ${host}.\n` +
  "  La cola es para el equipo de Danil dentro de su tailnet. Sin ese acceso, verifica en local con `pnpm verify`.\n" +
  "  Con acceso, comprueba Tailscale, o enciende la máquina si esta sesión no tiene credenciales de AWS.";

function parse(argv) {
  const options = { noCargo: false, commit: null, attach: null, cancel: null, status: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--remote") continue;
    else if (arg === "--no-cargo") options.noCargo = true;
    else if (arg === "--status") options.status = true;
    else if (arg === "--commit" || arg === "--attach" || arg === "--cancel") {
      const value = argv[(i += 1)];
      if (!value) throw new RemoteError(`${arg} necesita un valor`);
      options[arg.slice(2)] = value;
    } else throw new RemoteError(`--remote no acepta ${arg}`);
  }
  return options;
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", timeout: BUNDLE_TIMEOUT_MS, killSignal: "SIGKILL", windowsHide: true });
  if (result.status !== 0) throw new RemoteError(`git ${args[0]}: ${(result.stderr || result.error?.message || "").trim()}`);
  return result.stdout.trim();
}

const hasCommit = (sha) => spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { timeout: COMMAND_TIMEOUT_MS, windowsHide: true }).status === 0;

async function request(base, path, init = {}, timeoutMs = POLL_TIMEOUT_MS) {
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (response.ok) return response;
  const body = await response.json().catch(() => ({}));
  throw new RemoteError(body.error ?? `la cola respondió ${response.status}`);
}

const json = async (...args) => (await request(...args)).json();

async function health(base) {
  try {
    return await json(base, "/health", {}, HEALTH_TIMEOUT_MS);
  } catch {
    return null;
  }
}

/** Enciende con las credenciales de quien lanza: la máquina no guarda ninguna. */
function wake() {
  const aws = process.env.VERIFY_REMOTE_AWS ?? "aws";
  const instance = process.env.VERIFY_REMOTE_INSTANCE ?? DEFAULT_INSTANCE;
  const region = process.env.VERIFY_REMOTE_REGION ?? DEFAULT_REGION;
  const result = spawnSync(aws, ["ec2", "start-instances", "--region", region, "--instance-ids", instance], { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS, killSignal: "SIGKILL", windowsHide: true });
  return result.status === 0;
}

async function connect(base, host) {
  const first = await health(base);
  if (first) return first;
  console.log(`  La cola no responde en ${host}; intento encender la máquina.`);
  if (!wake()) throw new RemoteError(accessHelp(host));
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS * 2);
    const answer = await health(base);
    if (answer) return answer;
  }
  throw new RemoteError(accessHelp(host));
}

async function bundleFor(commit, known) {
  const dir = mkdtempSync(join(tmpdir(), "verify-remote-"));
  const file = join(dir, "commit.bundle");
  const ref = `refs/verify-remote/${commit}-${process.pid}`;
  git(["update-ref", ref, commit]);
  try {
    git(["bundle", "create", "-q", file, ref, ...known.filter(hasCommit).map((sha) => `^${sha}`)]);
    return { body: await openAsBlob(file), done: () => rmSync(dir, { recursive: true, force: true }) };
  } finally {
    git(["update-ref", "-d", ref]);
  }
}

async function submit(base, commit, command) {
  const { commits } = await json(base, `/repos/${REPO}/commits`);
  const bundle = commits.includes(commit) ? null : await bundleFor(commit, commits);
  try {
    const query = new URLSearchParams({ repo: REPO, commit, command });
    const init = { method: "POST", ...(bundle ? { body: bundle.body } : {}) };
    return await json(base, `/runs?${query}`, init, UPLOAD_TIMEOUT_MS);
  } finally {
    bundle?.done();
  }
}

function resumeHint(id) {
  console.error(`\n  La corrida ${id} sigue en la máquina. Retómala con \`pnpm verify --remote --attach ${id}\`.`);
}

async function follow(base, id) {
  let offset = 0;
  let lastPosition = null;
  let lastContact = Date.now();
  for (;;) {
    try {
      const run = await json(base, `/runs/${id}`);
      const chunk = Buffer.from(await (await request(base, `/runs/${id}/log?offset=${offset}`)).arrayBuffer());
      lastContact = Date.now();
      offset += chunk.length;
      if (chunk.length) process.stdout.write(chunk);
      if (run.state === "queued" && run.position !== lastPosition) {
        console.log(`  En cola: ${run.position === 0 ? "sigue" : `${run.position} antes`}.`);
        lastPosition = run.position;
      }
      if (!["queued", "running"].includes(run.state)) return run;
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      if (Date.now() - lastContact > LOST_AFTER_MS) {
        resumeHint(id);
        throw new RemoteError("Se perdió la conexión con la cola.");
      }
    }
    await sleep(POLL_MS);
  }
}

function report(run, platform, host) {
  const name = { linux: "Linux", darwin: "macOS", win32: "Windows" }[platform] ?? platform;
  const others = ["Linux", "macOS", "Windows"].filter((other) => other !== name).join(" y ");
  const words = { passed: "pasó", failed: `falló (exit ${run.exitCode})`, cancelled: "se canceló", interrupted: "se interrumpió: la cola se reinició" };
  console.log(`\n  Corrida remota ${run.id} ${words[run.state]}: ${run.commit.slice(0, 10)}, «${run.command}», ${name} en ${host}.`);
  console.log(`  ${others} NO se comprobó: una corrida --remote nunca cuenta por ellos.\n`);
  if (run.state === "passed") return 0;
  return run.state === "failed" ? run.exitCode : 1;
}

export async function runRemote(argv) {
  const host = process.env.VERIFY_REMOTE_HOST ?? DEFAULT_HOST;
  const base = `http://${host}`;
  try {
    const options = parse(argv);
    if (options.cancel) {
      const run = await json(base, `/runs/${options.cancel}/cancel`, { method: "POST" });
      console.log(`  Corrida ${run.id}: ${run.state}.`);
      return 0;
    }
    const { platform, runs } = await connect(base, host);
    if (options.status) {
      if (!runs.length) console.log("  La cola está vacía.");
      for (const run of runs) console.log(`  ${run.id} ${run.state} ${run.repo} ${run.commit.slice(0, 10)} «${run.command}»`);
      return 0;
    }
    if (options.attach) return report(await follow(base, options.attach), platform, host);

    if (!options.commit && git(["status", "--porcelain"])) throw new RemoteError("Hay cambios sin commit y la corrida solo lleva commits. Haz commit, o nombra uno con --commit <sha>.");
    const commit = git(["rev-parse", "--verify", `${options.commit ?? "HEAD"}^{commit}`]);
    const command = options.noCargo ? "pnpm verify --no-cargo" : "pnpm verify";
    const { id } = await submit(base, commit, command);
    console.log(`  Corrida ${id}: ${commit.slice(0, 10)}, «${command}», en ${host}.`);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(signal, () => {
        resumeHint(id);
        process.exit(130);
      });
    }
    return report(await follow(base, id), platform, host);
  } catch (error) {
    const known = error instanceof RemoteError;
    console.error(`\n  ${known ? error.message : accessHelp(host)}${known ? "" : `\n  (${error.message})`}\n`);
    return 2;
  }
}
