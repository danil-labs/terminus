import assert from "node:assert/strict";
import test from "node:test";

import { activeTrigger } from "../src/lib/mentions.ts";
import {
  insertRecipient,
  type RecipientCandidate,
  recipientId,
  recipientLabel,
  searchRecipients,
} from "../src/lib/recipients.ts";
import { referenceId } from "../src/lib/taskMentions.ts";

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
