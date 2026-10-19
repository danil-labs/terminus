import assert from "node:assert/strict";
import test from "node:test";

import { activeTrigger } from "../../src/lib/mentions.ts";
import type { AgenteDeMaquina, AgentProfile, CatalogoDeAgentes, HandlerDefinition } from "../../src/lib/model.ts";
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
const propio = (name: string, blocked: AgenteDeMaquina["blocked"]): AgenteDeMaquina => ({
  agent: declarado(name, { kind: "workspace" }), profile: perfil(false),
  folders: [], all_folders: true, blocked, catalog_taken: null,
});

// El repositorio declara `release`; tú tienes otro `release` que en esta
// carpeta pierde, y uno oculto que el riel tampoco pinta.
const roster = [
  declarado("release", null),
  declarado("qa-visual", null),
  declarado("oculto", null),
  declarado("revisor", { kind: "workspace" }),
  declarado("redactor", { kind: "project", id: "terminus" }),
];
const catalogo: CatalogoDeAgentes = {
  own: [
    propio("release", [{ folder: "terminus", origin: ".agents/release.md", repository: true }]),
    propio("revisor", []),
    // Tapado en otra carpeta: aquí no dice nada.
    propio("qa-visual", [{ folder: "billing", origin: ".agents/qa-visual.md", repository: true }]),
  ],
  repository: [],
};

test("los ocultos no salen y los del repositorio se distinguen de los tuyos", () => {
  const candidatos = recipientCandidatesOf("terminus", roster, {
    profiles: { oculto: perfil(true) },
    statuses: [{ name: "revisor", status: "working", minutes_since_last_turn: 1, live_tasks: 1 }],
  });
  assert.deepEqual(
    candidatos.map((c) => [c.name, c.repository, c.shadowed ?? false, c.status]),
    [
      ["release", true, false, undefined],
      ["qa-visual", true, false, undefined],
      ["revisor", false, false, "working"],
      ["redactor", false, false, undefined],
    ],
  );
});

test("un agente tuyo que el repositorio tapa en esta carpeta se marca, y solo en ella", () => {
  const aqui = recipientCandidatesOf("terminus", roster, { catalog: catalogo });
  assert.deepEqual(aqui.filter((c) => c.shadowed).map((c) => [c.name, c.repository]), [["release", false]]);
  const enOtra = recipientCandidatesOf("billing", roster, { catalog: catalogo });
  assert.deepEqual(enOtra.filter((c) => c.shadowed).map((c) => c.name), ["qa-visual"]);
  // Sin catálogo no se sabe quién está tapado, y no se inventa.
  assert.equal(recipientCandidatesOf("terminus", roster).some((c) => c.shadowed), false);
});

test("los del repositorio van en su grupo y los tuyos en el suyo, cada uno con su orden", () => {
  const candidatos = recipientCandidatesOf("terminus", roster, { catalog: catalogo });
  const { repository, own } = groupRecipients(candidatos, "re");
  assert.deepEqual(repository.map((c) => c.name), ["release"]);
  assert.deepEqual(own.map((c) => [c.name, c.shadowed ?? false]), [
    ["redactor", false],
    ["release", true],
    ["revisor", false],
  ]);
  const exacto = groupRecipients([...candidatos, { name: "re", description: "" }], "re");
  assert.equal(exacto.own[0]?.name, "re");
  assert.deepEqual(groupRecipients(candidatos, "visual").repository.map((c) => c.name), ["qa-visual"]);
});
