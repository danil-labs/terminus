import assert from "node:assert/strict";
import { test } from "node:test";
import { type Answer, type Computer, type ConnectProgress, INSTALL_URL, installCommand, watchNewComputer } from "../src/index.ts";

const old: Computer = { computer_id: "cmp_old", state: "online", provider: "self" };

/** Una lista que contesta, vuelta por vuelta, lo que se le da; la última se repite. */
function scripted(turns: Answer<Computer[]>[]) {
  let i = 0;
  return () => Promise.resolve(turns[Math.min(i++, turns.length - 1)]);
}

async function watch(turns: Answer<Computer[]>[], extra: Partial<Parameters<typeof watchNewComputer>[0]> = {}) {
  let clock = 0;
  const seen: ConnectProgress[] = [];
  const end = await watchNewComputer({
    list: scripted(turns),
    known: ["cmp_old"],
    onProgress: (p) => seen.push(p),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    ...extra,
  });
  return { end, seen: seen.map((p) => p.stage) };
}

const ok = (value: Computer[]): Answer<Computer[]> => ({ kind: "ok", value });

test("el comando instala desde Danil y cita el nombre para sh", () => {
  assert.equal(installCommand(), `curl -fsSL ${INSTALL_URL} | sh`);
  assert.equal(installCommand({ name: "  " }), `curl -fsSL ${INSTALL_URL} | sh`);
  assert.equal(installCommand({ name: "VPS de Ana's" }), `curl -fsSL ${INSTALL_URL} | sh -s -- --name 'VPS de Ana'\\''s'`);
  assert.equal(installCommand({ name: "$(rm -rf ~)" }), `curl -fsSL ${INSTALL_URL} | sh -s -- --name '$(rm -rf ~)'`);
});

test("una computadora nueva en línea termina la espera; las que ya estaban no cuentan", async () => {
  const fresh: Computer = { computer_id: "cmp_new", state: "offline", provider: "self" };
  const { end, seen } = await watch([ok([old]), ok([old, fresh]), ok([old, { ...fresh, state: "online" }])]);
  assert.deepEqual(seen, ["waiting", "enrolled", "online"]);
  assert.equal(end?.stage === "online" && end.computer.computer_id, "cmp_new");
});

test("inscrita pero nunca en línea falla en el tramo del relay", async () => {
  const fresh: Computer = { computer_id: "cmp_new", state: "offline" };
  const { end } = await watch([ok([old, fresh])], { onlineWait: 10_000, every: 3_000 });
  assert.deepEqual(end, { stage: "failed", hop: "relay", code: "machine_off", computer: fresh });
});

test("sin nada nuevo antes de que venza el código falla en la aprobación; un fallo de red no decide", async () => {
  const { end } = await watch([{ kind: "error", status: null }, ok([old])], { appearWait: 9_000 });
  assert.deepEqual(end, { stage: "failed", hop: "approval", code: "machine_timeout" });
});

test("otro contrato es version_mismatch, y la sesión decide el tramo de la cuenta", async () => {
  const fresh: Computer = { computer_id: "cmp_new", state: "online", contract: "aaaa" };
  assert.deepEqual((await watch([ok([old, fresh])], { outdated: (c) => c.contract === "aaaa" })).end, {
    stage: "failed",
    hop: "version",
    code: "version_mismatch",
    computer: fresh,
  });
  assert.deepEqual((await watch([{ kind: "unauthorized" }])).end, { stage: "failed", hop: "account", code: "unauthorized" });
  assert.deepEqual((await watch([{ kind: "license" }])).end, { stage: "failed", hop: "account", code: "license_required" });
});

test("cancelar para sin veredicto", async () => {
  const stop = new AbortController();
  stop.abort();
  assert.equal((await watch([ok([old])], { signal: stop.signal })).end, null);
});
