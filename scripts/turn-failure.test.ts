import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// El catálogo primero: sin él `t()` devuelve la clave, y lo que se afirmaría
// abajo son identificadores en vez de frases.
import "./catalog.ts";
import {
  gestoDelFallo as failureAction,
  prosaDelCambioPorCupo as quotaChangeText,
  prosaDelFallo as failureText,
} from "../src/features/chat/failures.ts";
import {
  esFilaDeLaBandeja as isInboxRow,
  idDeLaEntregaAntigua as oldDeliveryId,
  prosaDeLaFila as rowText,
  TOPE_DE_SALTOS as MAX_HOPS,
} from "../src/features/chat/inboxRows.ts";
import { transcripcion as transcript } from "../src/features/chat/transcript.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("el bloqueo de otra app se traduce al releer el fallo guardado", () => {
  assert.match(failureText({ text: "accounts.error.home_other_app" }), /Otra app de Terminus/);
});

test("cada clase de fallo dice algo distinto", () => {
  const classes = [
    "sin_cupo",
    "sin_saldo",
    "tope_de_gasto",
    "credencial",
    "proveedor_caido",
    "sin_red",
    "contexto_lleno",
    "modelo_no_existe",
    "politica",
    "memoria_perdida",
  ];
  const texts = new Set<string>();
  for (const failureClass of classes) {
    const text = failureText({ text: "crudo", fallo: { clase: failureClass, detail: "429" } });
    assert.ok(
      !text.includes(`chat.failure.${failureClass}`),
      `«${failureClass}» se quedó con la clave a la vista: ${text}`,
    );
    assert.ok(!text.includes("crudo"), `«${failureClass}» no debe repetir el crudo: ${text}`);
    texts.add(text);
  }
  assert.equal(texts.size, classes.length, "dos clases dicen lo mismo");
});

test("un fallo sin clase conserva el texto que ya se enseñaba", () => {
  const raw = "Claude no terminó este turno — salió con código 1: boom";
  assert.equal(failureText({ text: raw }), raw);
  assert.equal(
    failureText({ text: raw, fallo: { clase: "desconocido", detail: "código 1" } }),
    raw,
  );
});

test("la hora de vuelta y los reintentos solo salen si los hubo", () => {
  const alone = failureText({ text: "", fallo: { clase: "sin_cupo", detail: "429" } });
  assert.ok(!/\d/.test(alone.replace(/[^\d]/g, "")), `sin datos no hay números: ${alone}`);

  const withData = failureText({
    text: "",
    fallo: {
      clase: "sin_cupo",
      detail: "429",
      // 2026-08-25T18:40:00Z — la hora se pinta en la zona de quien mira, así
      // que lo que se afirma es que hay una, no cuál.
      vuelve_en: 1_787_690_400_000,
      reintentos: 5,
    },
  });
  assert.match(withData, /\d{1,2}[:.]\d{2}/, `sin la hora de vuelta: ${withData}`);
  assert.match(withData, /5/, `sin el número de intentos: ${withData}`);
});

test("la hora de vuelta lleva fecha cuando no es hoy", () => {
  const prose = (returnsAt: number) =>
    failureText({ text: "", fallo: { clase: "sin_cupo", detail: "429", vuelve_en: returnsAt } });

  const week = prose(Date.now() + 7 * 24 * 3_600_000);
  assert.match(week, /\d{4}/, `sin el año de vuelta: ${week}`);

  // Del final de hoy y no de `ahora + un minuto`: ese minuto cae en el día
  // siguiente durante el último minuto de cada día, y ahí la fecha sí sale.
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 0);
  const sameDay = prose(todayEnd.getTime());
  assert.ok(!/\d{4}/.test(sameDay), `sobra la fecha: ${sameDay}`);
});

test("cada clase ofrece el gesto que sirve, o ninguno", () => {
  assert.equal(failureAction("sin_cupo")?.accion, "cuentas");
  assert.equal(failureAction("sin_saldo")?.accion, "cuentas");
  assert.equal(failureAction("credencial")?.accion, "cuentas");
  assert.equal(failureAction("proveedor_caido")?.accion, "reintentar");
  assert.equal(failureAction("sin_red")?.accion, "reintentar");

  // Y las que no tienen gesto no lo fingen: decir qué pasó ya es todo lo que
  // esta pantalla puede hacer por quien mira.
  for (const sin of [
    "tope_de_gasto",
    "contexto_lleno",
    "modelo_no_existe",
    "politica",
    "memoria_perdida",
    "desconocido",
    undefined,
  ]) {
    assert.equal(failureAction(sin), null, `«${sin}» ofrece un gesto que no sirve`);
  }
});

test("el gesto nombra una clave que el catálogo define", () => {
  const es = JSON.parse(
    readFileSync(join(root, "src/locales/es/chat.json"), "utf8"),
  ) as Record<string, unknown>;
  for (const failureClass of ["sin_cupo", "sin_saldo", "credencial", "proveedor_caido", "sin_red"]) {
    const key = failureAction(failureClass)!.clave;
    assert.ok(es[key], `«${key}» no está en el catálogo`);
  }
});

test("un cupo en espera dice cuándo sigue solo, no cuándo vuelve", () => {
  const returnsAt = new Date(2026, 8, 25, 7, 0).getTime();
  const continuesAt = new Date(2026, 8, 25, 9, 30).getTime();
  const text = failureText({
    text: "crudo",
    fallo: { clase: "sin_cupo", detail: "429", vuelve_en: returnsAt, resumes_at: continuesAt },
  });
  assert.match(text, /Terminus la retoma sola/);
  assert.match(text, /9:30/);
  assert.doesNotMatch(text, /Vuelve a las/);
});

test("la línea del cupo dice a qué cuenta pasó y por qué", () => {
  const until = new Date(2026, 8, 25, 7, 0).getTime();
  const change = quotaChangeText({ from: "Cuenta 1", to: "Cuenta 2", until: until });
  assert.match(change, /^Se cambió a Cuenta 2 porque Cuenta 1 se quedó sin cupo hasta las .*7:00/);
  assert.equal(
    quotaChangeText({ from: "Cuenta 1", to: "Cuenta 2" }),
    "Se cambió a Cuenta 2 porque Cuenta 1 se quedó sin cupo.",
  );
  assert.equal(
    quotaChangeText({ from: "Cuenta 1" }),
    "Volvió el cupo de Cuenta 1; la tarea sigue.",
  );
  assert.equal(quotaChangeText({}), "Volvió el cupo; la tarea sigue.");
});

test("las filas de la Bandeja antigua sobreviven a reabrir su historial", () => {
  const sender = { folder: "p", task: "h1", title: "Revisión", agent: "claude" };
  const msgs = transcript([
    { role: "system", text: "Revisé el módulo.", meta: "task_finished", from_task: sender, hops: 1 },
    { role: "system", text: "", meta: "task_finished_read", from_task: sender, hops: 1 },
    { role: "system", text: "", meta: "task_chain_limit", from_task: sender, hops: 4 },
    { role: "system", text: "", meta: "woke_by_tasks", woke_by: ["h1", "h2"], hops: 1 },
    { role: "system", text: "", meta: "woke_by_tasks" },
  ]);
  assert.deepEqual(
    msgs.map((m) => m.meta),
    ["task_finished", "task_finished_read", "task_chain_limit", "woke_by_tasks", "woke_by_tasks"],
  );
  assert.equal(msgs[0].fromTask?.title, "Revisión");
  assert.deepEqual(msgs[3].woke_by, ["h1", "h2"]);
  assert.equal(msgs[4].woke_by, undefined);
  assert.ok(msgs.every((m) => isInboxRow(m.meta)));
});

test("cada fila histórica de la Bandeja dice algo distinto y sin la clave a la vista", () => {
  const texts = [
    rowText("task_finished", "Revisión", 0),
    rowText("task_finished_read", "Revisión", 0),
    rowText("task_chain_limit", "Revisión", 0),
    rowText("woke_by_tasks", null, 2),
    rowText("woke_by_tasks", null, 1),
    rowText("woke_by_tasks", null, 0),
    rowText("task_finished", null, 0),
  ];
  for (const text of texts) assert.ok(!/chat\.inbox|\{/.test(text), text);
  assert.equal(new Set(texts).size, texts.length);
  assert.match(texts[0], /Revisión/);
  assert.match(texts[2], new RegExp(String(MAX_HOPS)));
  assert.match(texts[3], /2/);
  assert.ok(!/\d/.test(texts[5]), `sin ids no se inventa cuántas: ${texts[5]}`);
});

// Rust abre el turno que contesta a la terminal con una línea sin texto; sin
// ella, al reabrir la tarea la respuesta del agente parece llegar de la nada.
test("la línea con que el agente contesta a la terminal sobrevive a reabrir la tarea", () => {
  const msgs = transcript([
    { role: "shell", text: "pnpm test", shell: { cwd: "/p", output: "ok", exit_code: 0, duration_ms: 1200, truncated: false } },
    { role: "system", text: "", meta: "shell_reply" },
    { role: "agent", text: "Pasaron todas." },
  ]);
  assert.deepEqual(msgs.map((m) => m.meta ?? m.role), ["usó", "shell_reply", "agent"]);
  assert.equal(msgs[0].shell?.duration_ms, 1200);
});

test("la respuesta entregada es una fila de sistema con el título, también la guardada antes", () => {
  const recipient = { folder: "p", task: "mfpbwsj1", title: "Revisión del contrato", agent: "claude" };
  const [current, old] = transcript([
    { role: "system", text: "", meta: "respondido", from_task: recipient, hops: 2 },
    { role: "system", text: "Respuesta entregada a la tarea «mfpbwsj1». Salto 2.", meta: "respondido" },
  ]);
  assert.ok(isInboxRow(current.meta) && isInboxRow(old.meta), "cae en «Trabajo»");
  const text = rowText("respondido", current.fromTask?.title ?? null, 0);
  assert.match(text, /Revisión del contrato/);
  const said = rowText("respondido", old.fromTask?.title ?? null, 0);
  for (const frase of [text, said]) {
    assert.ok(!/chat\.|\{|mfpbwsj1|Salto/.test(frase), frase);
  }
  assert.notEqual(said, rowText("task_finished", null, 0));
});

test("la entrega guardada antes nombra su tarea por el id de su prosa", () => {
  assert.equal(oldDeliveryId("Respuesta entregada a la tarea «mfpbwsj1». Salto 2."), "mfpbwsj1");
  assert.equal(oldDeliveryId("Respuesta entregada."), null);
  assert.equal(oldDeliveryId(""), null);
});
