import assert from "node:assert/strict";
import test from "node:test";

import { activeTrigger } from "../../src/lib/mentions.ts";
import type { AgentProfile, HandlerDefinition } from "../../src/lib/model.ts";
import {
  groupRecipients,
  insertRecipient,
  type RecipientCandidate,
  recipientId,
  recipientCandidatesOf,
  recipientLabel,
  searchRecipients,
} from "../../src/lib/recipients.ts";
import { referenceId } from "../../src/lib/taskMentions.ts";

// Los nombres son los que un repositorio declara de verdad: cortos, sin
// extensión y sin barra. Es justo la forma que choca con la de un archivo, la
// razón de que el grupo de encargados encabece el menú.
const encargados: RecipientCandidate[] = [
  { name: "arquitecto", description: "Decide la forma del sistema" },
  { name: "revisor", description: "Lee el diff antes de entregar", status: "working" },
  { name: "arqueologo", description: "Busca por qué se hizo así" },
];

test("el nombre exacto encabeza, luego el prefijo, luego lo que contiene", () => {
  assert.deepEqual(
    searchRecipients(encargados, "arq").map((c) => c.name),
    ["arqueologo", "arquitecto"],
  );
  assert.deepEqual(
    searchRecipients([...encargados, { name: "arq", description: "" }], "arq").map((c) => c.name),
    ["arq", "arqueologo", "arquitecto"],
  );
});

// El id del menú es lo único que viaja del clic a la inserción: si el de un
// encargado coincidiera con el de una tarea o una carpeta, elegir a alguien
// adjuntaría material, y al revés.
test("el id de un encargado no choca con el de ninguna referencia", () => {
  assert.equal(recipientId("revisor"), "handler-revisor");
  const materiales = [
    referenceId({ kind: "task", projectId: "p1", sessionId: "revisor" }),
    referenceId({ kind: "folder", projectId: "revisor" }),
    referenceId({ kind: "portfolio", portfolioId: "revisor" }),
  ];
  assert.ok(!materiales.includes(recipientId("revisor")));
});

test("elegir del menú sustituye lo tecleado y deja el destinatario apuntando a su etiqueta", () => {
  const texto = "por favor @arq";
  const disparador = activeTrigger(texto, texto.length);
  assert.ok(disparador);
  const label = recipientLabel("arquitecto");
  const draft = insertRecipient({ text: texto }, disparador, "arquitecto", label);
  assert.equal(draft.text, "por favor @arquitecto ");
  assert.deepEqual(draft.recipients, [
    { name: "arquitecto", start: 10, end: 10 + label.length, text: label },
  ]);
  // La etiqueta apunta a lo que de verdad hay escrito ahí, que es lo que Rust
  // vuelve a comprobar contra el prompt mandado.
  const [r] = draft.recipients!;
  assert.equal(draft.text.slice(r.start, r.end), r.text);
  assert.deepEqual(draft.task_mentions, []);
});

const declarado = (name: string, own_scope: HandlerDefinition["own_scope"]): HandlerDefinition => ({
  name, description: `${name} hace lo suyo`, instructions: "", tools: [], model: null,
  origin: `${name}.md`, folder: null, providers: [], own: own_scope !== null, own_scope,
});
const perfil = (hidden: boolean): AgentProfile => ({
  display_name: null, body: null, background: null, avatar: null, veil: 0.82,
  provider: null, model: null, effort: null, hidden,
});

// El repositorio declara `release` y `qa-visual`; hay uno oculto que el riel
// tampoco pinta. Uno tuyo que el repositorio tapa no llega en la lista.
const roster = [
  declarado("release", null),
  declarado("qa-visual", null),
  declarado("oculto", null),
  declarado("revisor", { kind: "workspace" }),
  declarado("redactor", { kind: "project", id: "terminus" }),
];
test("los ocultos no salen y los del repositorio se distinguen de los tuyos", () => {
  const candidatos = recipientCandidatesOf(roster, {
    profiles: { oculto: perfil(true) },
    statuses: [{ name: "revisor", status: "working", minutes_since_last_turn: 1, live_tasks: 1 }],
  });
  assert.deepEqual(
    candidatos.map((c) => [c.name, c.repository, c.status]),
    [
      ["release", true, undefined],
      ["qa-visual", true, undefined],
      ["revisor", false, "working"],
      ["redactor", false, undefined],
    ],
  );
});

test("los del repositorio van en su grupo y los tuyos en el suyo, cada uno con su orden", () => {
  const candidatos = recipientCandidatesOf(roster);
  const { repository, own } = groupRecipients(candidatos, "re");
  assert.deepEqual(repository.map((c) => c.name), ["release"]);
  assert.deepEqual(own.map((c) => c.name), ["redactor", "revisor"]);
  const exacto = groupRecipients([...candidatos, { name: "re", description: "" }], "re");
  assert.equal(exacto.own[0]?.name, "re");
  assert.deepEqual(groupRecipients(candidatos, "visual").repository.map((c) => c.name), ["qa-visual"]);
});
