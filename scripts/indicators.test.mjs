import assert from "node:assert/strict";
import test from "node:test";
import { collect, parseLine, pipeline, quantile, report, resources } from "./indicators.mjs";

const one = (name, ms) => `[2026-09-20][19:00:00][app_lib::util][INFO] [tiempo] ${name} — ${ms} ms`;
const tally = (name, rest) => `[2026-09-20][19:10:00][app_lib::util][INFO] [tiempo] ${name} — ${rest}`;

test("a tally line is read with the names util.rs writes", () => {
  const line = tally("list_sessions", "count=1000 sum_ms=1000 max_ms=1 lt_1=0 lt_5=1000 lt_20=0 lt_50=0 lt_100=0");
  const parsed = parseLine(line);
  assert.equal(parsed.count, 1000);
  assert.deepEqual(parsed.buckets, [0, 1000, 0, 0, 0]);
});

test("a line that is not a measurement is ignored", () => {
  assert.equal(parseLine("[2026-09-20][19:00:00][app_lib::chat][INFO] servicio listo"), null);
  assert.equal(parseLine(""), null);
});

test("per-call lines and tallies of one name add up", () => {
  const log = [
    tally("list_sessions", "count=98 sum_ms=120 max_ms=4 lt_1=40 lt_5=58 lt_20=0 lt_50=0 lt_100=0"),
    one("list_sessions", 236),
    one("list_sessions", 2255),
  ].join("\n");
  const total = collect(log).get("list_sessions");
  assert.equal(total.count, 100);
  assert.equal(total.maxMs, 2255);
  assert.deepEqual(quantile(total, 0.5), { ms: 5, exact: false });
  assert.deepEqual(quantile(total, 0.99), { ms: 236, exact: true });
  assert.deepEqual(quantile(total, 1), { ms: 2255, exact: true });
});

test("the report sorts by total time and marks bucket bounds", () => {
  const log = [one("fast", 3), one("slow", 900), one("slow", 1100)].join("\n");
  const [, first, second] = report(collect(log)).split("\n");
  assert.match(first, /^slow\s+2\s+900\s+1100\s+1100\s+2\.0$/);
  assert.match(second, /^fast\s+1\s+<5\s+<5\s+3\s+0\.0$/);
});

test("resource lines are averaged per process and keep the peak", () => {
  const log = [
    "[2026-09-20][19:00:00][app_lib::util][INFO] [resources] role=window cpu_pct=10.0 max_rss_mb=90 window_s=300",
    "[2026-09-20][19:05:00][app_lib::util][INFO] [resources] role=window cpu_pct=2.0 max_rss_mb=94 window_s=300",
    "[2026-09-20][19:05:00][app_lib::util][INFO] [resources] role=service cpu_pct=33.8 max_rss_mb=463 window_s=300",
  ].join("\n");
  const byRole = resources(log);
  assert.deepEqual(byRole.get("window"), { samples: 2, cpuSum: 12, cpuMax: 10, maxRssMb: 94, maxOpenFds: 0, fdLimit: 0 });
  assert.equal(byRole.get("service").maxRssMb, 463);
});

test("pipeline lines add up to the real fusion ratio", () => {
  const log = [
    "[2026-09-20][19:00:00][x][INFO] [pipeline] polls=2400 events_in=9000 events_out=1000 coalesce=true",
    "[2026-09-20][19:10:00][x][INFO] [pipeline] polls=2400 events_in=1000 events_out=1000 coalesce=true",
  ].join("\n");
  assert.deepEqual(pipeline(log), { polls: 4800, eventsIn: 10000, eventsOut: 2000 });
  assert.deepEqual(pipeline("nothing here"), { polls: 0, eventsIn: 0, eventsOut: 0 });
});

test("resource lines keep the peak of open descriptors against their limit", () => {
  const log = [
    "[x][INFO] [resources] role=service cpu_pct=1.0 max_rss_mb=100 window_s=300 open_fds=40 fd_limit=8192",
    "[x][INFO] [resources] role=service cpu_pct=1.0 max_rss_mb=100 window_s=300 open_fds=231 fd_limit=8192",
  ].join("\n");
  const service = resources(log).get("service");
  assert.equal(service.maxOpenFds, 231);
  assert.equal(service.fdLimit, 8192);
});
