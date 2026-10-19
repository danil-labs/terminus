#!/usr/bin/env node
/**
 * Lee las medidas `[tiempo]` del log de la app y las resume por nombre.
 *
 *   pnpm indicators --log <archivo.log> [--log <otro.log>]
 *   cat <archivo.log> | pnpm indicators
 *
 * La ruta del log se recibe, no se deduce: cuelga del identificador del
 * bundle.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Los mismos topes que `BUCKETS_MS` en `src-tauri/src/util.rs`. */
export const BUCKETS_MS = [1, 5, 20, 50, 100];

const ONE = /\[tiempo\] (.+?) — (\d+) ms\s*$/;
const TALLY = /\[tiempo\] (.+?) — count=(\d+) sum_ms=(\d+) max_ms=(\d+) (.+)$/;

const empty = () => ({ count: 0, sumMs: 0, maxMs: 0, buckets: BUCKETS_MS.map(() => 0), slow: [] });

/** Una línea del log, o `null` si no es una medida. */
export function parseLine(line) {
  const tally = TALLY.exec(line);
  if (tally) {
    const fields = Object.fromEntries(tally[5].trim().split(/\s+/).map((pair) => pair.split("=")));
    return {
      name: tally[1],
      count: Number(tally[2]),
      sumMs: Number(tally[3]),
      maxMs: Number(tally[4]),
      buckets: BUCKETS_MS.map((limit) => Number(fields[`lt_${limit}`] ?? 0)),
      slow: [],
    };
  }
  const one = ONE.exec(line);
  if (!one) return null;
  const ms = Number(one[2]);
  const slot = BUCKETS_MS.findIndex((limit) => ms < limit);
  return {
    name: one[1],
    count: 1,
    sumMs: ms,
    maxMs: ms,
    buckets: BUCKETS_MS.map((_, i) => (i === slot ? 1 : 0)),
    slow: slot === -1 ? [ms] : [],
  };
}

/** Las medidas de un texto de log, sumadas por nombre. */
export function collect(text) {
  const byName = new Map();
  for (const line of text.split("\n")) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const total = byName.get(parsed.name) ?? empty();
    total.count += parsed.count;
    total.sumMs += parsed.sumMs;
    total.maxMs = Math.max(total.maxMs, parsed.maxMs);
    total.buckets = total.buckets.map((n, i) => n + parsed.buckets[i]);
    total.slow.push(...parsed.slow);
    byName.set(parsed.name, total);
  }
  return byName;
}

/** El cuantil `q`: el tope de su cubeta con `exact: false`, o el valor medido desde 100 ms. */
export function quantile(total, q) {
  if (total.count === 0) return { ms: 0, exact: true };
  const rank = Math.max(1, Math.ceil(total.count * q));
  let seen = 0;
  for (let i = 0; i < BUCKETS_MS.length; i++) {
    seen += total.buckets[i];
    if (rank <= seen) return { ms: BUCKETS_MS[i], exact: false };
  }
  const slow = [...total.slow].sort((a, b) => a - b);
  return { ms: slow[Math.min(slow.length - 1, rank - seen - 1)], exact: true };
}

const show = ({ ms, exact }) => (exact ? `${ms}` : `<${ms}`);

export function report(byName) {
  const rows = [...byName.entries()].sort((a, b) => b[1].sumMs - a[1].sumMs);
  const lines = ["name                                      count     p50     p95     max   total_s"];
  for (const [name, total] of rows) {
    lines.push(
      [
        name.padEnd(38),
        String(total.count).padStart(8),
        show(quantile(total, 0.5)).padStart(7),
        show(quantile(total, 0.95)).padStart(7),
        String(total.maxMs).padStart(7),
        (total.sumMs / 1000).toFixed(1).padStart(9),
      ].join(" "),
    );
  }
  return lines.join("\n");
}

const fieldsOf = (rest) => Object.fromEntries(rest.trim().split(/\s+/).map((pair) => pair.split("=")));

/** Las líneas `[resources]` de `util::report_resources`, resumidas por proceso. */
export function resources(text) {
  const byRole = new Map();
  for (const line of text.split("\n")) {
    const found = /\[resources\] (.+)$/.exec(line);
    if (!found) continue;
    const f = fieldsOf(found[1]);
    const role = byRole.get(f.role) ?? { samples: 0, cpuSum: 0, cpuMax: 0, maxRssMb: 0, maxOpenFds: 0, fdLimit: 0 };
    role.samples += 1;
    role.cpuSum += Number(f.cpu_pct);
    role.cpuMax = Math.max(role.cpuMax, Number(f.cpu_pct));
    role.maxRssMb = Math.max(role.maxRssMb, Number(f.max_rss_mb));
    role.maxOpenFds = Math.max(role.maxOpenFds, Number(f.open_fds ?? 0));
    role.fdLimit = Math.max(role.fdLimit, Number(f.fd_limit ?? 0));
    byRole.set(f.role, role);
  }
  return byRole;
}

/** Las líneas `[pipeline]` de `coalesce::record`: cuánto se funde de verdad. */
export function pipeline(text) {
  const total = { polls: 0, eventsIn: 0, eventsOut: 0 };
  for (const line of text.split("\n")) {
    const found = /\[pipeline\] (.+)$/.exec(line);
    if (!found) continue;
    const f = fieldsOf(found[1]);
    total.polls += Number(f.polls);
    total.eventsIn += Number(f.events_in);
    total.eventsOut += Number(f.events_out);
  }
  return total;
}

function extras(text) {
  const lines = [];
  const byRole = resources(text);
  if (byRole.size > 0) {
    lines.push("", "process     samples  cpu_pct_mean  cpu_pct_max  max_rss_mb  max_open_fds/limit");
    for (const [role, r] of byRole)
      lines.push(
        [role.padEnd(10), String(r.samples).padStart(8), (r.cpuSum / r.samples).toFixed(1).padStart(13), r.cpuMax.toFixed(1).padStart(12), String(r.maxRssMb).padStart(11), `${r.maxOpenFds}/${r.fdLimit}`.padStart(20)].join(" "),
      );
  }
  const p = pipeline(text);
  if (p.polls > 0) {
    const ratio = p.eventsOut > 0 ? (p.eventsIn / p.eventsOut).toFixed(2) : "-";
    lines.push("", `pipeline: ${p.polls} polls, ${p.eventsIn} events in, ${p.eventsOut} out (${ratio} in per out)`);
  }
  return lines.join("\n");
}

function main(argv) {
  const files = argv.flatMap((arg, i) => (arg === "--log" && argv[i + 1] ? [argv[i + 1]] : []));
  const text = files.length > 0 ? files.map((file) => readFileSync(file, "utf8")).join("\n") : readFileSync(0, "utf8");
  console.log(report(collect(text)));
  console.log(extras(text));
  console.log("\nms are wall-clock, not CPU: a command waiting on a lock or a child process counts its wait.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
