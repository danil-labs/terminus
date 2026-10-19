import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/App.tsx", "utf8");
const start = source.indexOf("  async function reintentar() {");
const end = source.indexOf("\n  }", start) + 4;
const original = source.slice(start, end);

function reintento({ invoke, setError = () => {} }) {
  return new Function("msgs", "sessionId", "project", "setRetenida", "invoke", "setError", "prosaDe", "editarBorrador", "claveAbierta", "mandar", `${original}; return reintentar;`)(
    () => [{ role: "user", text: "delegar" }, { role: "system", text: "falló", meta: "fallo", resume: "deliveries" }],
    () => "padre",
    () => "proyecto",
    () => {},
    invoke,
    setError,
    (e) => `prosa: ${e}`,
    () => { throw new Error("no debe reponer el borrador"); },
    () => "padre",
    async () => { throw new Error("no debe mandar un input"); },
  );
}

test("reintentar una entrega fallida conserva la reanudacion interna", async () => {
  const calls = [];
  const retry = reintento({ invoke: async (...args) => calls.push(args) });
  await retry();
  assert.deepEqual(calls, [["reintentar_reanudacion_por_entregas", { project: "proyecto", session: "padre" }]]);
});

test("un rechazo del reintento de entregas se muestra sin escribir al historial", async () => {
  const errors = [];
  const retry = reintento({ invoke: async () => { throw "chat.turn.busy"; }, setError: (e) => errors.push(e) });
  await retry();
  assert.deepEqual(errors, ["prosa: chat.turn.busy"]);
});
