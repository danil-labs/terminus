/**
 * El atajo de cambio de pestaña, en lo que no da error al romperse: un atajo
 * que no dispara se lee como un teclado raro, y uno que dispara de más mueve
 * de tarea sin que se vea por qué. Lo que fija: la tecla se lee por posición
 * física, el 9 es la última y un número de más no hace nada, y el ciclo da la
 * vuelta entrando por el extremo de su sentido.
 */
import assert from "node:assert/strict";
import test from "node:test";

const {
  navegacionDePestanas,
  destinoDePestana,
  accionDeAtajo,
  ventanaVecina,
  flechaDeLista,
} = await import("../src/lib/shortcuts.ts");
const { panelReadingOrder: recorridoDeVentanas } = await import("../src/lib/panels.ts");

type Tecla = {
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
};

const tecla = (t: Tecla) =>
  ({
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...t,
  }) as KeyboardEvent;

const cmd = (t: Tecla) => tecla({ metaKey: true, ...t });

test("el dígito se lee por posición física", () => {
  assert.deepEqual(navegacionDePestanas(cmd({ key: "3", code: "Digit3" })), {
    tipo: "indice",
    n: 2,
  });
  // AZERTY sin Shift: la misma tecla escribe «"» y el atajo sale igual.
  assert.deepEqual(navegacionDePestanas(cmd({ key: '"', code: "Digit3" })), {
    tipo: "indice",
    n: 2,
  });
  // El dígito del teclado numérico no es el atajo del navegador.
  assert.equal(navegacionDePestanas(cmd({ key: "3", code: "Numpad3" })), null);
});

test("el 9 es la última", () => {
  assert.deepEqual(navegacionDePestanas(cmd({ key: "9", code: "Digit9" })), {
    tipo: "ultima",
  });
  assert.deepEqual(destinoDePestana({ tipo: "ultima" }, ["a", "b", "c"], "a"), "c");
});

test("sin modificador, con Shift o ya atendido no dispara", () => {
  assert.equal(navegacionDePestanas(tecla({ key: "1", code: "Digit1" })), null);
  assert.equal(
    navegacionDePestanas(cmd({ key: "1", code: "Digit1", shiftKey: true })),
    null,
  );
  assert.equal(
    navegacionDePestanas(cmd({ key: "1", code: "Digit1", defaultPrevented: true })),
    null,
  );
  // El 0 es la escala, no una pestaña (`lib/zoom.ts`).
  assert.equal(navegacionDePestanas(cmd({ key: "0", code: "Digit0" })), null);
});

test("las flechas ciclan y no chocan con el árbol", () => {
  assert.deepEqual(navegacionDePestanas(cmd({ key: "ArrowRight", altKey: true })), {
    tipo: "ciclo",
    delta: 1,
  });
  assert.deepEqual(navegacionDePestanas(cmd({ key: "PageUp" })), {
    tipo: "ciclo",
    delta: -1,
  });
  // `⌘⌥B` sigue siendo el árbol de trabajo y no una pestaña.
  assert.equal(
    navegacionDePestanas(cmd({ key: "b", code: "KeyB", altKey: true })),
    null,
  );
  assert.equal(accionDeAtajo(cmd({ key: "b", code: "KeyB", altKey: true })), "workTree");
});

test("un número fuera de la tira no hace nada", () => {
  assert.equal(destinoDePestana({ tipo: "indice", n: 4 }, ["a", "b"], "a"), null);
  assert.equal(destinoDePestana({ tipo: "indice", n: 0 }, [], null), null);
  assert.equal(destinoDePestana({ tipo: "ciclo", delta: 1 }, [], null), null);
});

test("el ciclo da la vuelta por los dos lados", () => {
  const tira = ["a", "b", "c"];
  assert.equal(destinoDePestana({ tipo: "ciclo", delta: 1 }, tira, "c"), "a");
  assert.equal(destinoDePestana({ tipo: "ciclo", delta: -1 }, tira, "a"), "c");
  assert.equal(destinoDePestana({ tipo: "ciclo", delta: 1 }, tira, "a"), "b");
});

test("sin pestaña delante entra por el extremo de su sentido", () => {
  const tira = ["a", "b", "c"];
  assert.equal(destinoDePestana({ tipo: "ciclo", delta: 1 }, tira, null), "a");
  assert.equal(destinoDePestana({ tipo: "ciclo", delta: -1 }, tira, null), "c");
});

test("el número cuenta el orden de la tira, no la identidad", () => {
  // Reordenar arrastrando cambia a qué pestaña va el ⌘1: es una posición.
  assert.equal(destinoDePestana({ tipo: "indice", n: 0 }, ["a", "b"], null), "a");
  assert.equal(destinoDePestana({ tipo: "indice", n: 0 }, ["b", "a"], null), "b");
});

test("la vertical cambia de ventana y la horizontal no", () => {
  assert.equal(ventanaVecina(cmd({ key: "ArrowDown", altKey: true })), 1);
  assert.equal(ventanaVecina(cmd({ key: "ArrowUp", altKey: true })), -1);
  assert.equal(ventanaVecina(cmd({ key: "ArrowRight", altKey: true })), null);
  // Sin Alt es la flecha pelada, y con Shift es selección de texto en macOS.
  assert.equal(ventanaVecina(cmd({ key: "ArrowDown" })), null);
  assert.equal(ventanaVecina(cmd({ key: "ArrowDown", altKey: true, shiftKey: true })), null);
  assert.equal(navegacionDePestanas(cmd({ key: "ArrowDown", altKey: true })), null);
});

test("una flecha con modificador no es navegación de lista", () => {
  assert.equal(flechaDeLista(tecla({ key: "ArrowRight" })), true);
  assert.equal(flechaDeLista(tecla({ key: "ArrowRight", shiftKey: true })), true);
  assert.equal(flechaDeLista(cmd({ key: "ArrowRight", altKey: true })), false);
  assert.equal(flechaDeLista(tecla({ key: "ArrowRight", ctrlKey: true })), false);
});

test("las ventanas se recorren en orden de lectura", () => {
  assert.deepEqual(recorridoDeVentanas([1]), [{ col: 0, fila: 0 }]);
  assert.deepEqual(recorridoDeVentanas([1, 1]), [
    { col: 0, fila: 0 },
    { col: 1, fila: 0 },
  ]);
  // El 2×2: la de arriba a la derecha va segunda, no tercera.
  assert.deepEqual(recorridoDeVentanas([2, 2]), [
    { col: 0, fila: 0 },
    { col: 1, fila: 0 },
    { col: 0, fila: 1 },
    { col: 1, fila: 1 },
  ]);
  // Una columna sin partir al lado de una partida no inventa una ventana.
  assert.deepEqual(recorridoDeVentanas([1, 2]), [
    { col: 0, fila: 0 },
    { col: 1, fila: 0 },
    { col: 1, fila: 1 },
  ]);
  assert.deepEqual(recorridoDeVentanas([]), []);
});
