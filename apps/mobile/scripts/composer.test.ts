/**
 * El cuadro de escribir del teléfono: qué tecla manda y cuál hace salto de
 * línea, y con qué modo de permisos arranca y se manda un mensaje.
 *
 *   node --test apps/mobile/scripts/composer.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountWorkspace } from "@terminus/computers";
import type { PermissionModeOption } from "@terminus/protocol";
import { effectiveMode, enterAction, hasSomethingToSend, initialMode } from "../src/lib/composer.ts";
import { workspaceEntries } from "../src/lib/engine.ts";

const label = { key: "x" };
// Claude: los tres; `ediciones` es el que resolvió el motor.
const CLAUDE: PermissionModeOption[] = [
  { id: "manual", label },
  { id: "ediciones", label, por_omision: true },
  { id: "auto", label },
];
// Un proveedor sin «automático».
const OTHER: PermissionModeOption[] = [
  { id: "manual", label, por_omision: true },
  { id: "ediciones", label },
  { id: "auto", label, falta: { key: "no" } },
];

test("Enter manda; Shift+Enter hace salto de línea, como en el escritorio", () => {
  assert.equal(enterAction({ key: "Enter" }), "send");
  assert.equal(enterAction({ key: "Enter", shiftKey: true }), "newline");
  assert.equal(enterAction({ key: "a" }), null, "las demás teclas siguen su curso");
});

test("Enter que confirma un carácter compuesto (IME) no manda", () => {
  assert.equal(enterAction({ key: "Enter", isComposing: true }), null);
  assert.equal(enterAction({ key: "Enter", keyCode: 229 }), null, "Safari marca la composición con 229");
});

test("no se manda vacío, ni un `!` sin comando", () => {
  assert.equal(hasSomethingToSend("   \n ", 0), false);
  assert.equal(hasSomethingToSend("", 1), true, "un adjunto subido basta");
  assert.equal(hasSomethingToSend("hola", 0), true);
  assert.equal(hasSomethingToSend("! ", 0), false);
  assert.equal(hasSomethingToSend("!ls", 0), true);
});

test("arranca con el modo del workspace, no con el del proveedor", () => {
  assert.equal(initialMode(CLAUDE, "auto"), "auto");
  assert.equal(effectiveMode(CLAUDE, null, { workspace: "auto" }), "auto", "y es el que se manda");
  assert.equal(initialMode(CLAUDE, null), "ediciones", "sin modo del workspace, el del proveedor");
});

test("si el proveedor no sostiene el del workspace, cae al suyo por omisión", () => {
  assert.equal(initialMode(OTHER, "auto"), "manual");
  assert.equal(effectiveMode(OTHER, null, { workspace: "auto" }), "manual");
  assert.equal(effectiveMode(OTHER, "auto", { workspace: "auto" }), "manual", "uno elegido que este proveedor no tiene tampoco se manda");
  assert.equal(initialMode([], "auto"), null, "sin lista, nada que marcar");
});

test("lo que elige la persona manda sobre el del workspace", () => {
  assert.equal(effectiveMode(CLAUDE, "manual", { workspace: "auto" }), "manual");
  assert.equal(effectiveMode(CLAUDE, "ediciones", { workspace: "auto" }), "ediciones", "aunque sea el del proveedor");
});

test("una tarea abierta sigue con su modo guardado, no con el del workspace", () => {
  assert.equal(effectiveMode(CLAUDE, null, { saved: "manual", workspace: "auto" }), "manual");
  assert.equal(effectiveMode(OTHER, null, { saved: "auto", workspace: "ediciones" }), "ediciones", "si ya no lo sostiene, el del workspace");
  assert.equal(effectiveMode(CLAUDE, "auto", { saved: "manual" }), "auto", "lo elegido manda");
});

test("sin lista de modos (la máquina apagada): el de la tarea, o `auto`, que todo proveedor sostiene", () => {
  assert.equal(effectiveMode([], null, { workspace: "auto" }), "auto", "el del workspace, no `null`");
  assert.equal(effectiveMode([], null, { workspace: "manual" }), null, "uno que quizá no sostenga lo negaría el motor");
  assert.equal(effectiveMode([], null, { saved: "manual", workspace: "auto" }), "manual", "el guardado, que el motor baja si hace falta");
  assert.equal(effectiveMode([], null, {}), null);
});

test("el modo del workspace sale de la máquina que contesta, o del registro de la cuenta", () => {
  const registry: AccountWorkspace[] = [{ id: "w1", name: "Producto", projects: [], computers: ["vm"], settings: { default_permission_mode: "auto" } }];
  const hosts = [{ id: "vm" }, { id: "mac" }];
  const fromMachine = workspaceEntries(hosts, { vm: null, mac: [{ id: "w1", name: "Producto", default_permission_mode: "manual" }] }, registry);
  assert.equal(fromMachine[0].defaultPermissionMode, "manual");
  const asleep = workspaceEntries(hosts, { vm: null, mac: [] }, registry);
  assert.equal(asleep[0].defaultPermissionMode, "auto", "la VM dormida: el del registro");
  const none = workspaceEntries(hosts, { vm: null, mac: [{ id: "w1", name: "Producto" }] }, null);
  assert.equal(none[0].defaultPermissionMode, null);
});
