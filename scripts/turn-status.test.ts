import assert from "node:assert/strict";
import test from "node:test";

// El catálogo primero: sin él, `t()` devuelve la clave y lo que se afirma
// abajo son rótulos en español.
import "./catalog.ts";
import { agrupar as groupSteps, cuentaDelTramo as segmentCount, enCurso as inProgress, pasoDe as stepOf, pasoDePermiso as permissionStep, pasoDeSistema as systemStep, resumen as summary, rotuloDeFila as rowLabel } from "../src/lib/steps.ts";


test("cada herramienta en curso se nombra en presente y con su sujeto", () => {
  assert.deepEqual(inProgress(stepOf("Read", "src/features/chat/Chat.tsx")), {
    verbo: "Leyendo",
    sujeto: "Chat.tsx",
  });
  assert.deepEqual(inProgress(stepOf("Write", "src/lib/steps.ts")), {
    verbo: "Escribiendo",
    sujeto: "steps.ts",
  });
  assert.deepEqual(inProgress(stepOf("Edit", "src/lib/steps.ts")), {
    verbo: "Editando",
    sujeto: "steps.ts",
  });
  assert.deepEqual(inProgress(stepOf("Grep", "corriendo")), {
    verbo: "Buscando",
    sujeto: "corriendo",
  });
  assert.deepEqual(inProgress(stepOf("WebSearch", "mcp login")), {
    verbo: "Consultando la web",
    sujeto: "mcp login",
  });
  assert.deepEqual(inProgress(stepOf("TodoWrite", null)), {
    verbo: "Anotando el plan",
    sujeto: null,
  });
  // Lo que no está en la tabla se nombra con su nombre crudo, que es más
  // honesto que forzarlo a una categoría.
  assert.deepEqual(inProgress(stepOf("mcp__figma__get_file", "1234")), {
    verbo: "Usando mcp__figma__get_file",
    sujeto: "1234",
  });
});

test("un comando en curso se enseña sin su envoltorio y en una línea", () => {
  assert.deepEqual(inProgress(stepOf("Bash", '/bin/zsh -lc "pnpm verificar\nls"')), {
    verbo: "Ejecutando",
    sujeto: "pnpm verificar",
  });
});

test("la cabecera de un tramo cuenta por clase, y las ediciones por archivo", () => {
  const segment = [
    stepOf("Read", "a.ts"),
    stepOf("Read", "b.ts"),
    stepOf("Edit", "a.ts"),
    stepOf("Edit", "a.ts"),
    stepOf("Write", "c.ts"),
    stepOf("Bash", "pnpm verificar"),
    permissionStep("Bash", "rm -rf dist", false),
  ];
  assert.equal(
    segmentCount(segment),
    "Leyó 2 archivos, editó 2 archivos, ejecutó 1 comando, 1 permiso denegado",
  );
  // La fila agrupada y la cabecera dicen la misma cifra: si no, el tramo
  // pliega «editó 2» y desplegado enseña «Cambió 3».
  const [edit] = groupSteps(segment.slice(2, 5));
  assert.equal(summary(edit).verbo, "Cambió 2 archivos");
  assert.equal(segmentCount([systemStep("aviso", "Se guardó el árbol.")]), null);
});

// El tramo vivo no ha terminado nada: en pasado, su cabecera afirma lo contrario
// mientras el loader dice que sigue.
test("un tramo vivo se cuenta en gerundio, y su fila en curso también", () => {
  const segment = [
    stepOf("Edit", "a.ts"),
    stepOf("Write", "c.ts"),
    { ...stepOf("Bash", "pnpm verificar"), corriendo: true },
  ];
  assert.equal(segmentCount(segment, true), "Editando 2 archivos, ejecutando 1 comando");
  assert.equal(segmentCount(segment), "Editó 2 archivos, ejecutó 1 comando");
  const rows = groupSteps(segment);
  assert.equal(rowLabel(rows.at(-1)!).verbo, "Ejecutando");
  assert.equal(rowLabel(rows[0]).verbo, "Cambió 2 archivos");
});
