/**
 * Los pasos de un turno en el chat del teléfono (`src/lib/steps.ts`): los avances,
 * las herramientas y la respuesta en su orden, como la ventana.
 *
 *   node --test apps/mobile/scripts/steps.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Turn } from "@terminus/protocol";
import { applyLive, bareCommand, linesOfLive, linesOfTurn } from "../src/lib/steps.ts";

test("con el orden registrado: avance, pasos y la respuesta al final", () => {
  const turn: Turn = {
    id: "t1",
    role: "agent",
    text: "Listo, ya pasa.",
    tools: [
      { name: "Read", target: "/repo/src/a.ts" },
      { name: "Read", target: "/repo/src/b.ts" },
      { name: "Bash", target: '/bin/zsh -lc "cd /repo && npm test"', ok: false },
      { name: "Write", target: "/repo/.preguntas.json" },
    ],
    pieces: [{ text: "Miro el código." }, { tool: 0 }, { tool: 1 }, { tool: 2 }, { tool: 3 }, { text: "Listo, ya pasa." }],
  };
  const lines = linesOfTurn(turn, "t1", []);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["progress", "steps", "message"],
  );
  const steps = lines[1];
  assert.ok(steps.kind === "steps");
  assert.deepEqual(steps.rows.map((r) => [r.kind, r.steps.length]), [["read", 2], ["run", 1]], "las lecturas seguidas son una fila y la pregunta no es paso");
  assert.equal(steps.rows[1].steps[0].ok, false);
  assert.ok(lines[2].kind === "message" && lines[2].text === "Listo, ya pasa.");
});

test("sin orden registrado, los pasos van delante del texto; un `!` trae su salida", () => {
  const lines = linesOfTurn({ role: "agent", text: "Hecho", tools: [{ name: "Edit", target: "a.ts" }] }, "k", []);
  assert.deepEqual(lines.map((l) => l.kind), ["steps", "message"]);
  const shell = linesOfTurn({ role: "user", text: "ls", shell: { cwd: "/", output: "a\nb", exit_code: 0, duration_ms: 3, truncated: false } }, "s", []);
  assert.deepEqual(shell, [{ key: "s", kind: "shell", command: "ls", output: "a\nb", exitCode: 0 }]);
  assert.equal(bareCommand('/bin/zsh -lc "cd \\"/a b\\" && git status"'), 'cd \\"/a b\\" && git status');
  assert.equal(bareCommand("cd /repo && git status"), "git status");
});

test("en vivo: los pasos corren y cierran, y el texto anterior queda como avance", () => {
  let live = applyLive([], { kind: "delta", text: "Voy " });
  live = applyLive(live, { kind: "delta", text: "a mirar." });
  live = applyLive(live, { kind: "tool", text: "Bash", target: "npm test" });
  assert.equal(linesOfLive(live).at(-1)?.kind, "steps");
  live = applyLive(live, { kind: "tool_done", text: "Bash", ok: true });
  live = applyLive(live, { kind: "delta", text: "Pasa.", starts_message: true });
  const lines = linesOfLive(live);
  assert.deepEqual(lines.map((l) => l.kind), ["progress", "steps", "message"]);
  assert.ok(lines[0].kind === "progress" && lines[0].text === "Voy a mirar.");
  assert.ok(lines[1].kind === "steps" && !lines[1].rows[0].steps[0].running && lines[1].rows[0].steps[0].ok === true);
  assert.equal(lines[2].key, "live");
});

test("el input de un encargado o de otra tarea lleva quién lo escribió; el de la persona, no", () => {
  const [mine] = linesOfTurn({ role: "user", text: "hola" }, "t0", []);
  assert.equal(mine.kind === "message" && mine.from, null);
  const [byAgent] = linesOfTurn({ role: "user", text: "revisa esto", agent: "Ada" }, "t1", []);
  assert.deepEqual(byAgent.kind === "message" && byAgent.from, { agent: "Ada", task: null, provider: null });
  const fromTask = { folder: "web", task: "t-9", title: "Arreglar el login", provider: "codex" };
  const [byTask] = linesOfTurn({ role: "user", text: "listo", from_task: fromTask }, "t2", []);
  assert.deepEqual(byTask.kind === "message" && byTask.from, { agent: null, task: "Arreglar el login", provider: "codex" });
});
