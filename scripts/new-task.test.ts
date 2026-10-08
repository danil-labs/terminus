import assert from "node:assert/strict";
import test from "node:test";

import type { Project } from "../src/lib/model.ts";
import {
  claveDeBorrador as draftKey,
  esProvisional as isProvisional,
  fuentesHeredadas as inheritedSources,
  idProvisional as provisionalId,
  proyectoDeNuevaTarea as newTaskProject,
  tituloProvisional as provisionalTitle,
  unirFuentes as combineSources,
} from "../src/lib/taskDraft.ts";

const project: Project = {
  id: "alfa",
  name: "Alfa",
  node: null,
  sources: ["manuales", "api", "diseno"],
  working_directory: "/trabajo/alfa",
  created_at: 1,
  updated_at: 1,
  sessions: 1,
  kind: "folder",
};

test("el borrador separa proyectos y conserva la sesión elegida", () => {
  assert.equal(newTaskProject(undefined, "alfa"), "alfa");
  assert.equal(newTaskProject("beta", "alfa"), "beta");
  assert.equal(draftKey("sesion-vieja", "alfa"), "sesion-vieja");
  assert.equal(draftKey(null, "alfa"), "borrador:alfa");
  assert.notEqual(
    draftKey(null, "alfa"),
    draftKey(null, "beta"),
  );

});

test("el borrador hereda las tres fuentes y puede quitar o sumar una", () => {
  assert.deepEqual(inheritedSources([project], "alfa", []), [
    "manuales",
    "api",
    "diseno",
  ]);
  assert.deepEqual(inheritedSources([project], "alfa", ["api"]), [
    "manuales",
    "diseno",
  ]);
  assert.deepEqual(
    combineSources(
      inheritedSources([project], "alfa", ["api"]),
      ["brief"],
      ["manuales"],
    ),
    ["manuales", "diseno", "brief"],
  );
});

test("el nombre provisional es la primera línea con algo del encargo", () => {
  assert.equal(provisionalTitle("  \n\n  arregla el cohete  \ny lo demás"), "arregla el cohete");
  assert.equal(provisionalTitle("una sola línea"), "una sola línea");
  assert.equal(provisionalTitle("   \n \t "), "");
  assert.equal(provisionalTitle(""), "");
});

// Ese id no viaja a ningún `invoke` ni se guarda: nombrar con él una tarea que
// Rust ya creó pediría una sesión que no existe.
test("el id provisional se distingue del que da Rust y no se repite", () => {
  const first = provisionalId();
  const second = provisionalId();
  assert.notEqual(first, second);
  assert.equal(isProvisional(first), true);
  assert.equal(isProvisional("ad38babb"), false);
  assert.equal(isProvisional(null), false);
  assert.equal(isProvisional(undefined), false);
});
