import assert from "node:assert/strict";
import test from "node:test";

/**
 * **La rejilla de ventanas, en lo que se rompe callado.**
 *
 * Nada de esto da un error cuando falla, y todo se ve como «raro» y no como
 * roto: una ventana se queda con un tamaño que no le toca, o cerrar la última
 * pestaña deja una celda en blanco al lado de la conversación, o una pestaña
 * arrastrada aparece en dos tiras a la vez.
 *
 * Y las que este archivo existe para fijar:
 *
 * - **los anchos suman uno y hay uno por columna, los altos suman uno y hay uno
 *   por fila.** Si dejan de cumplirse, `grid-template-columns` recibe un `NaN`
 *   de fracción y las celdas se pintan donde les dé la gana;
 * - **ninguna pestaña está en dos ventanas**, que es cómo se rompe un arrastre;
 * - **ninguna ventana se queda vacía**, salvo la última — que es el único gesto
 *   de cierre que hay, y de donde sale que no haga falta ninguna flecha.
 */

// `localStorage` no existe en Node sin banderas, y `lib/prefs.ts` lo usa al
// guardar. Un stub en memoria es suficiente: lo que se prueba es qué se guarda,
// no dónde.
const almacen = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => void almacen.set(k, v),
  removeItem: (k: string) => void almacen.delete(k),
  clear: () => void almacen.clear(),
  key: (i: number) => [...almacen.keys()][i] ?? null,
  get length() {
    return almacen.size;
  },
};

const {
  createPanels: createPanels,
  MAX_COLUMNS: MAX_COLUMNS,
  MAX_ROWS: MAX_ROWS,
  gridTracks: gridTracks,
  gridCell: gridCell,
  dividerSpan: dividerSpan,
  sameSite: sameSite,
  saveLayout,
  readLayout,
  deleteLayout,
  spacesWithLayout,
} = await import("../src/lib/panels.ts");

type P = ReturnType<typeof createPanels>;

/** Que suman uno, que son positivos, y que hay tantos como pistas. */
const fracciones = (ts: number[], cuantas: number, que: string) => {
  assert.equal(ts.length, cuantas, `un ${que} por pista`);
  const suma = ts.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(suma - 1) < 1e-9, `los ${que} suman ${suma}`);
  assert.ok(
    ts.every((t) => t > 0),
    `hay una pista sin ${que}: ${JSON.stringify(ts)}`,
  );
};

/** La rejilla entera en pie. */
const sano = (p: P) => {
  const cols = p.columns();
  fracciones(p.widths(), cols.length, "ancho");
  fracciones(p.heights(), p.rowCount(), "alto");
  assert.ok(
    cols.every((c) => c.length > 0),
    `hay una columna sin ventanas: ${JSON.stringify(cols)}`,
  );
  const todas = cols.flatMap((c) => c.flatMap((g) => g.pestanas));
  assert.equal(
    new Set(todas).size,
    todas.length,
    `una pestaña está en dos ventanas: ${JSON.stringify(cols)}`,
  );
  for (const c of cols)
    for (const g of c) {
      assert.ok(
        p.groupCount() === 1 || g.pestanas.length > 0,
        "una ventana se quedó vacía y no se cerró",
      );
      if (g.activa !== null)
        assert.ok(
          g.pestanas.includes(g.activa),
          `una ventana enseña algo que no tiene: ${g.activa}`,
        );
    }
  assert.ok(p.groupAt(p.activeSite()) !== null, "la ventana activa no existe");
  assert.ok(
    cols.length <= MAX_COLUMNS && p.rowCount() <= MAX_ROWS,
    "la rejilla se salió de su tope",
  );
};

/** Una rejilla con `n` pestañas ya repartidas en la primera ventana. */
const con = (...ids: string[]): P => {
  const p = createPanels();
  p.sync(ids);
  return p;
};

test("no se parte lo que se quedaría solo", () => {
  const p = con("a");
  // Mover la única pestaña a una ventana nueva cerraría la de origen: el
  // resultado sería el mismo de antes en otro sitio. Es lo que apaga el botón.
  assert.equal(p.split("a"), false);
  assert.equal(p.groupCount(), 1);
  sano(p);
});

test("sin sitio a lo ancho, la siguiente baja: la rejilla llega a 2×2", () => {
  const p = con("a", "b", "c", "d");
  p.split("a");
  p.split("b");
  assert.deepEqual(p.siteOf("b"), { col: 1, fila: 1 }, "parte la de la derecha");
  assert.deepEqual(p.heights(), [0.5, 0.5], "la primera fila parte por la mitad");
  assert.deepEqual(p.widths(), [0.5, 0.5], "abrir una fila no toca los anchos");
  p.split("c");
  assert.deepEqual(p.siteOf("c"), { col: 0, fila: 1 });
  assert.equal(p.groupCount(), 4);
  assert.equal(p.canSplit(), false, "con 2×2 no cabe ninguna más");
  assert.equal(p.split("d"), false);
  sano(p);
});

test("la segunda columna sale de la última, no de la primera", () => {
  const p = con("a", "b", "c");
  p.split("a");
  p.resizeColumns(0, 0.7, 0.3);
  p.split("b");
  // Abrir una fila no reparte anchos: la columna de la izquierda estaba en 0,7
  // porque alguien la dejó ahí.
  assert.deepEqual(p.widths(), [0.7, 0.3]);
  sano(p);
});

/**
 * **Partir arrastrando hasta un borde.** En vez de soltar la pestaña en el
 * primer hueco libre, el gesto elige el lado: a la izquierda o a la derecha
 * (columna nueva) y arriba o abajo (fila nueva). Lo que puede salir mal no da
 * error: la pestaña aparece del lado contrario, o la rejilla se sale del 2×2.
 */
test("partir a un lado pone la columna nueva de ese lado", () => {
  const right = con("a", "b");
  assert.equal(right.canSplitAt("a", { col: 0, fila: 0 }, "right"), true);
  assert.equal(right.splitAt("a", { col: 0, fila: 0 }, "right"), true);
  assert.deepEqual(right.siteOf("a"), { col: 1, fila: 0 }, "a la derecha");
  assert.deepEqual(right.tabsAt({ col: 0, fila: 0 }), ["b"]);
  assert.deepEqual(right.widths(), [0.5, 0.5]);
  assert.deepEqual(right.activeSite(), { col: 1, fila: 0 });
  sano(right);

  const left = con("a", "b");
  assert.equal(left.splitAt("a", { col: 0, fila: 0 }, "left"), true);
  assert.deepEqual(left.siteOf("a"), { col: 0, fila: 0 }, "a la izquierda");
  assert.deepEqual(left.tabsAt({ col: 1, fila: 0 }), ["b"]);
  assert.deepEqual(left.widths(), [0.5, 0.5]);
  sano(left);
});

test("partir arriba o abajo pone la fila nueva de ese lado", () => {
  const down = con("a", "b");
  assert.equal(down.splitAt("a", { col: 0, fila: 0 }, "down"), true);
  assert.deepEqual(down.siteOf("a"), { col: 0, fila: 1 });
  assert.deepEqual(down.siteOf("b"), { col: 0, fila: 0 });
  assert.deepEqual(down.heights(), [0.5, 0.5]);
  sano(down);

  const up = con("a", "b");
  assert.equal(up.splitAt("a", { col: 0, fila: 0 }, "up"), true);
  assert.deepEqual(up.siteOf("a"), { col: 0, fila: 0 });
  assert.deepEqual(up.siteOf("b"), { col: 0, fila: 1 });
  assert.deepEqual(up.heights(), [0.5, 0.5]);
  sano(up);
});

test("partir arrastrando no vacía la ventana de origen", () => {
  const p = con("a", "b");
  p.split("a"); // dos ventanas, una pestaña cada una
  // Arrastrar la única de su ventana a un borde no parte: moverla dejaría la de
  // origen vacía y se cerraría, así que el gesto solo la movería.
  assert.equal(p.canSplitAt("a", { col: 0, fila: 0 }, "right"), false);
  assert.equal(p.splitAt("a", { col: 0, fila: 0 }, "right"), false);
  sano(p);
});

test("con la rejilla llena no se parte por ningún lado", () => {
  const p = con("a", "b", "c", "d", "e");
  p.split("a");
  p.split("b");
  p.split("c");
  assert.equal(p.groupCount(), 4);
  // `d` y `e` comparten panel: la negativa tiene que ser por el tope 2×2, no
  // porque la ventana de origen se quede sin nada.
  assert.deepEqual(p.tabsAt({ col: 0, fila: 0 }), ["d", "e"]);
  for (const side of ["left", "right", "up", "down"] as const) {
    assert.equal(p.canSplitAt("d", { col: 0, fila: 0 }, side), false, side);
    assert.equal(p.splitAt("d", { col: 0, fila: 0 }, side), false, side);
  }
  sano(p);
});

test("de una columna apilada se parte hacia un lado", () => {
  const p = con("a", "b", "c");
  p.splitAt("a", { col: 0, fila: 0 }, "down"); // [b,c] arriba · [a] abajo
  assert.deepEqual(p.rowsPerColumn(), [2]);
  assert.equal(p.canSplitAt("b", { col: 0, fila: 0 }, "right"), true);
  assert.equal(p.splitAt("b", { col: 0, fila: 0 }, "right"), true);
  assert.deepEqual(p.siteOf("b"), { col: 1, fila: 0 });
  assert.deepEqual(p.siteOf("a"), { col: 0, fila: 1 });
  assert.deepEqual(p.tabsAt({ col: 0, fila: 0 }), ["c"]);
  assert.deepEqual(p.rowsPerColumn(), [2, 1]);
  sano(p);
});

test("partir la columna corta de un 2+1 no rehace el reparto de altos", () => {
  const p = con("a", "b", "c", "d");
  p.split("a");
  p.split("b");
  assert.deepEqual(p.rowsPerColumn(), [1, 2]);
  assert.deepEqual(p.heights(), [0.5, 0.5]);
  p.resizeRows(0, 0.3, 0.7);
  assert.equal(p.splitAt("c", { col: 0, fila: 0 }, "down"), true);
  assert.deepEqual(p.siteOf("c"), { col: 0, fila: 1 });
  assert.deepEqual(p.tabsAt({ col: 0, fila: 0 }), ["d"]);
  assert.deepEqual(
    p.heights(),
    [0.3, 0.7],
    "la fila nueva usa la pista que ya había, no la reparte otra vez",
  );
  sano(p);
});

test("partir contra una ventana que no existe no hace nada", () => {
  const p = con("a", "b");
  assert.equal(p.canSplitAt("a", { col: 3, fila: 0 }, "right"), false);
  assert.equal(p.splitAt("a", { col: 3, fila: 0 }, "right"), false);
  assert.equal(p.canSplitAt("fantasma", { col: 0, fila: 0 }, "right"), false);
  sano(p);
});

test("cerrar la última pestaña cierra su ventana, y no hace falta nada más", () => {
  const p = con("a", "b");
  p.split("a");
  assert.equal(p.groupCount(), 2);
  // **Este es el punto del rediseño.** La `✕` de la pestaña es el único gesto de
  // cierre: la ventana se va sola al quedarse sin nada, como
  // `workbench.editor.closeEmptyGroups` de VS Code. No hay flecha de «devolver».
  p.close("a");
  assert.equal(p.groupCount(), 1, "la ventana vacía se cerró sola");
  assert.deepEqual(p.widths(), [1], "el ancho volvió al vecino");
  assert.deepEqual(p.siteOf("a"), null);
  assert.deepEqual(p.tabsAt({ col: 0, fila: 0 }), ["b"]);
  sano(p);
});

test("cerrar una de varias no cierra la ventana, y deja delante la vecina", () => {
  const p = con("a", "b", "c");
  p.activate("b");
  p.close("b");
  assert.deepEqual(p.tabsAt({ col: 0, fila: 0 }), ["a", "c"]);
  assert.equal(p.activeTabAt({ col: 0, fila: 0 }), "c", "la de la derecha");
  p.close("c");
  assert.equal(p.activeTabAt({ col: 0, fila: 0 }), "a", "y si no, la de la izquierda");
  sano(p);
});

test("arrastrar una pestaña a otra ventana la mueve, y no la copia", () => {
  const p = con("a", "b", "c");
  p.split("a");
  const derecha = { col: 1, fila: 0 };
  assert.equal(p.move("b", derecha), true);
  assert.deepEqual(p.tabsAt(derecha), ["a", "b"]);
  assert.deepEqual(p.tabsAt({ col: 0, fila: 0 }), ["c"]);
  assert.equal(p.activeTabAt(derecha), "b", "lo soltado queda delante");
  assert.deepEqual(p.activeSite(), derecha, "y su ventana pasa a mandar");
  sano(p);
});

test("arrastrar la última de la IZQUIERDA no pierde el destino de la derecha", () => {
  const p = con("a", "b");
  p.split("a"); // izquierda: [b] · derecha: [a]
  // Mover `b` —la única de la izquierda— a la derecha cierra su ventana, y
  // entonces **la columna 1 pasa a ser la 0**. Buscar el destino por sus
  // coordenadas apuntaría a una columna que ya no existe y la pestaña caería en
  // la nada, sin error. Por eso `mover` lo busca por su ventana.
  //
  // El caso simétrico —arrastrar desde la derecha— no lo caza: ahí el destino
  // es la columna 0 y no se mueve. Este archivo tenía solo aquel, y la rotura a
  // propósito de esta línea pasaba las 26 pruebas.
  assert.equal(p.move("b", { col: 1, fila: 0 }), true);
  assert.equal(p.groupCount(), 1);
  assert.deepEqual(p.tabsAt({ col: 0, fila: 0 }).sort(), ["a", "b"]);
  assert.deepEqual(p.widths(), [1]);
  sano(p);
});

test("arrastrar dentro de la misma tira reordena", () => {
  const p = con("a", "b", "c");
  const uno = { col: 0, fila: 0 };
  assert.equal(p.move("c", uno, 0), true);
  assert.deepEqual(p.tabsAt(uno), ["c", "a", "b"]);
  assert.equal(p.move("c", uno, 0), false, "soltar donde ya está no hace nada");
  assert.equal(p.move("a", uno, 2), true);
  assert.deepEqual(p.tabsAt(uno), ["c", "b", "a"]);
  sano(p);
});

test("la ventana activa manda, y activar una pestaña se la lleva el mando", () => {
  const p = con("a", "b");
  p.split("a");
  assert.deepEqual(p.activeSite(), { col: 1, fila: 0 });
  p.activate("b");
  assert.deepEqual(p.activeSite(), { col: 0, fila: 0 }, "el mando sigue a la pestaña");
  assert.equal(p.isVisible("a"), true, "la otra sigue enseñándose, solo que sin mando");
  assert.equal(p.isVisible("b"), true);
  p.focus({ col: 1, fila: 0 });
  assert.deepEqual(p.activeSite(), { col: 1, fila: 0 }, "y se puede enfocar sin más");
  sano(p);
});

test("una pestaña nueva cae en la ventana activa, no siempre en la primera", () => {
  const p = con("a", "b");
  p.split("a");
  // El mando está en la de la derecha: lo que se abra ahora aparece ahí, que es
  // donde se está mirando.
  p.sync(["a", "b", "nueva"]);
  assert.deepEqual(p.siteOf("nueva"), { col: 1, fila: 0 });
  assert.equal(p.activeTabAt({ col: 1, fila: 0 }), "a", "sin robarle el frente");
  sano(p);
});

test("cerrar una tarea se lleva de golpe las pestañas de sus documentos", () => {
  const p = con("t", "d1", "d2");
  p.split("d1");
  // `cerrarPestana` sincroniza con todo lo que dejó de existir, y una tarea se
  // lleva sus documentos detrás (`lib/tabs.ts`). Se van de una pasada, así
  // que los índices se renumeran bajo el propio bucle.
  p.sync([]);
  assert.equal(p.groupCount(), 1);
  assert.deepEqual(p.tabsAt({ col: 0, fila: 0 }), []);
  assert.deepEqual(p.widths(), [1]);
  assert.deepEqual(p.heights(), [1]);
  sano(p);
});

/**
 * Un archivo abierto antes de la tarea cambia de id cuando el primer turno la
 * crea (`lib/tabs.ts` · `reatar`). Sin renombrarlo aquí, la siguiente pasada de
 * `sincronizar` lo ve como uno que murió y otro que nació: la pestaña salta de
 * la ventana partida a la activa y quien la había puesto al lado la pierde.
 */
test("renombrar una pestaña la deja en su ventana y delante", () => {
  const p = con("t", "viejo");
  p.split("viejo");
  p.renameTabs([["viejo", "nuevo"]]);
  assert.deepEqual(p.tabsAt({ col: 1, fila: 0 }), ["nuevo"]);
  assert.equal(p.activeTabAt({ col: 1, fila: 0 }), "nuevo");
  assert.equal(p.sync(["t", "nuevo"]), false, "nada que reconciliar");
  sano(p);
});

test("juntar recoge la ventana activa en la de al lado", () => {
  const p = con("a", "b", "c");
  p.split("a");
  p.move("b", { col: 1, fila: 0 });
  assert.equal(p.join(), true);
  assert.equal(p.groupCount(), 1);
  assert.deepEqual(p.tabsAt({ col: 0, fila: 0 }).sort(), ["a", "b", "c"]);
  assert.equal(p.join(), false, "con una sola ventana no hay nada que juntar");
  sano(p);
});

test("cerrar la ventana de abajo recoge la fila, y no deja media pantalla vacía", () => {
  const p = con("a", "b", "c");
  p.split("a");
  p.split("b");
  assert.deepEqual(p.heights(), [0.5, 0.5]);
  p.close("b");
  // Sin recoger la fila, la rejilla se quedaba con dos pistas y la de arriba
  // ocupando media pantalla contra un hueco en blanco.
  assert.deepEqual(p.heights(), [1], "sin nadie partido vuelve a una fila");
  assert.deepEqual(p.widths(), [0.5, 0.5], "las columnas no se enteran");
  sano(p);
});

test("con las dos columnas partidas, cerrar una no recoge la fila", () => {
  const p = con("a", "b", "c", "d");
  p.split("a");
  p.split("b");
  p.split("c");
  p.resizeRows(0, 0.3, 0.7);
  p.close("b");
  // `c` sigue abajo a la izquierda, así que la línea horizontal no se va — y se
  // queda donde la dejaron, no vuelve a la mitad.
  assert.deepEqual(p.heights(), [0.3, 0.7]);
  assert.equal(p.rowCount(), 2);
  sano(p);
});

test("un reparto fuera de rango no rompe las pistas", () => {
  const p = con("a", "b");
  p.resizeColumns(0, 0.5, 0.5);
  assert.deepEqual(p.widths(), [1], "sin vecino a la derecha no hay reparto");
  p.resizeRows(0, 0.5, 0.5);
  assert.deepEqual(p.heights(), [1], "ni debajo");
  p.split("a");
  p.resizeColumns(-1, 0.5, 0.5);
  p.resizeColumns(5, 0.5, 0.5);
  p.resizeRows(3, 0.5, 0.5);
  assert.deepEqual(p.widths(), [0.5, 0.5]);
  sano(p);
});

test("cambiar de workspace deja una sola ventana", () => {
  const p = con("a", "b", "c");
  p.split("a");
  p.split("b");
  p.reset();
  assert.equal(p.groupCount(), 1);
  assert.deepEqual(p.tabsAt({ col: 0, fila: 0 }), []);
  assert.deepEqual(p.widths(), [1]);
  assert.deepEqual(p.heights(), [1]);
  assert.deepEqual(p.activeSite(), { col: 0, fila: 0 });
  sano(p);
});

/**
 * **La geometría de la cuadrícula, que es lo que no se ve fallar.**
 *
 * Un `grid-row` mal numerado no da error: pone dos ventanas en la misma celda y
 * el navegador las apila una encima de la otra. Un `/ -1` que falta deja media
 * pantalla en blanco debajo de una columna sin partir. Y una pista de divisor
 * que se cuenta mal corre todo lo que viene detrás una celda.
 *
 * Se prueba aquí y no montando el componente porque **es aritmética**: las
 * pruebas de este repo no levantan jsdom, y lo que hay que fijar son los
 * números, no el DOM.
 */

test("las pistas intercalan la del divisor, y las fr no la pagan", () => {
  assert.equal(gridTracks([1]), "1fr", "sin vecino no hay divisor que intercalar");
  assert.equal(gridTracks([0.5, 0.5]), "0.5fr 12px 0.5fr");
  assert.equal(gridTracks([0.7, 0.3]), "0.7fr 12px 0.3fr");
});

test("la celda cae en la pista impar, y la última de su columna llega al final", () => {
  assert.deepEqual(gridCell({ col: 0, fila: 0 }, 1), {
    "grid-column": "1",
    "grid-row": "1 / -1",
  });
  // La columna 1 salta la pista del divisor: 2·1 + 1 = 3.
  assert.deepEqual(gridCell({ col: 1, fila: 0 }, 1), {
    "grid-column": "3",
    "grid-row": "1 / -1",
  });
  assert.deepEqual(gridCell({ col: 1, fila: 0 }, 2), {
    "grid-column": "3",
    "grid-row": "1",
  });
  assert.deepEqual(gridCell({ col: 1, fila: 1 }, 2), {
    "grid-column": "3",
    "grid-row": "3 / -1",
  });
});

test("el divisor vertical cruza entero; el horizontal, solo lo partido", () => {
  assert.deepEqual(dividerSpan(0, false, [1, 2]), {
    "grid-column": "2",
    "grid-row": "1 / -1",
  });
  // La maqueta `1 + 2`: la línea horizontal no cruza la columna sin partir.
  assert.deepEqual(dividerSpan(0, true, [1, 2]), {
    "grid-row": "2",
    "grid-column": "3 / 4",
  });
  assert.deepEqual(dividerSpan(0, true, [2, 2]), {
    "grid-row": "2",
    "grid-column": "1 / 4",
  });
  assert.deepEqual(dividerSpan(0, true, [2, 1]), {
    "grid-row": "2",
    "grid-column": "1 / 2",
  });
});

test("la rejilla real y su geometría no se contradicen", () => {
  const p = con("a", "b", "c");
  p.split("a");
  p.split("b");
  const sitios = p
    .sites()
    .map((s) => JSON.stringify(gridCell(s, p.rowsPerColumn()[s.col])));
  assert.equal(
    new Set(sitios).size,
    sitios.length,
    `dos ventanas en la misma celda: ${sitios}`,
  );
  assert.equal(sameSite({ col: 0, fila: 0 }, { col: 0, fila: 0 }), true);
  assert.equal(sameSite({ col: 0, fila: 0 }, { col: 1, fila: 0 }), false);
  assert.equal(sameSite(null, { col: 0, fila: 0 }), false);
});

/**
 * **La conversación en blanco, que es lo único que ocupa una celda sin ser una
 * pestaña.**
 *
 * `blanquear()` deja una ventana con sus pestañas y sin ninguna delante. Eso
 * inventa un vacío que el invariante de arriba no mide: `sano` cuenta
 * `pestanas.length`, y aquí la cuenta está bien —lo que falta es qué enseñar—.
 * De ahí sale el fallo que estas pruebas fijan: la izquierda en negro, con sus
 * pestañas todavía en la tira, tras hacer una tarea nueva y clicar la derecha.
 *
 * Lo que se afirma es el contrato que `App.tsx` pinta: **toda ventana sin
 * pestaña delante es una ventana en blanco**, y sigue siéndolo cuando el mando
 * se va a otra. Si alguien vuelve a colgar el blanco de la ventana activa,
 * estas dos fallan.
 */
test("blanquear deja la ventana sin nada delante, y conserva sus pestañas", () => {
  const p = con("a", "b");
  assert.equal(p.activeTabAt({ col: 0, fila: 0 }), "b");
  p.showDraft();
  assert.equal(
    p.activeTabAt({ col: 0, fila: 0 }),
    null,
    "la ventana sigue enseñando algo después de blanquear",
  );
  assert.deepEqual(
    p.tabsAt({ col: 0, fila: 0 }),
    ["a", "b"],
    "blanquear se llevó las pestañas, y solo debía soltar la de delante",
  );
  assert.equal(p.isVisible("b"), false);
  sano(p);
});

test("el blanco se queda en SU ventana cuando el mando se va a otra", () => {
  const p = con("a", "b");
  p.split("b");
  const izq = p.sites().find((s) => p.tabsAt(s).includes("a"))!;
  const der = p.sites().find((s) => p.tabsAt(s).includes("b"))!;
  assert.ok(izq && der, "partir no dejó dos ventanas");

  // Tarea nueva en la izquierda: se queda sin pestaña delante.
  p.focus(izq);
  p.showDraft();
  assert.equal(p.activeTabAt(izq), null);

  // Y clicar la derecha no se lo devuelve ni se lo lleva: la izquierda sigue
  // siendo la que está en blanco, así que `App.tsx` tiene dónde pintarla.
  p.activate("b");
  assert.equal(p.activeTabAt(der), "b");
  assert.equal(
    p.activeTabAt(izq),
    null,
    "enfocar otra ventana le devolvió la pestaña a la que estaba en blanco",
  );
  assert.deepEqual(
    p.tabsAt(izq),
    ["a"],
    "la ventana en blanco perdió sus pestañas al cambiar de mando",
  );
  sano(p);
});

test("blanquear no toca las demás ventanas", () => {
  const p = con("a", "b");
  p.split("b");
  const izq = p.sites().find((s) => p.tabsAt(s).includes("a"))!;
  const der = p.sites().find((s) => p.tabsAt(s).includes("b"))!;
  p.focus(der);
  p.showDraft();
  assert.equal(p.activeTabAt(der), null);
  assert.equal(
    p.activeTabAt(izq),
    "a",
    "blanquear una ventana apagó la de al lado",
  );
  sano(p);
});

/**
 * El reparto de un espacio, que vuelve al cambiar de espacio y al reiniciar.
 *
 * Nada de esto da error cuando falla: volver a un espacio deja una sola
 * ventana, o la trae partida pero con las columnas de otro sitio, o el mando
 * apuntando a una celda que ya no existe. Un valor viejo o a medio escribir se
 * lee y se pinta igual, así que aquí se fija qué se guarda y qué se acepta al
 * volver.
 */

test("el reparto vuelve entero: rejilla, geometría y mando", () => {
  const p = con("a", "b", "c");
  p.split("a"); // [b,c] · [a]
  p.resizeColumns(0, 0.7, 0.3);
  p.focus({ col: 0, fila: 0 });

  const q = createPanels();
  q.restore(p.layout(), ["a", "b", "c"]);
  assert.deepEqual(q.tabsAt({ col: 0, fila: 0 }), ["b", "c"]);
  assert.deepEqual(q.tabsAt({ col: 1, fila: 0 }), ["a"]);
  assert.deepEqual(q.widths(), [0.7, 0.3], "los anchos se pierden al volver");
  assert.deepEqual(q.activeSite(), { col: 0, fila: 0 });
  sano(q);
});

test("restaurar solo reparte lo que sigue vivo", () => {
  const p = con("a", "b", "c");
  p.split("a"); // [b,c] · [a]
  const q = createPanels();
  // `a` murió —una pestaña de contenido no vuelve—: su ventana se cae y la
  // rejilla vuelve a una sola, sin celda muerta al lado.
  q.restore(p.layout(), ["b", "c"]);
  assert.equal(q.groupCount(), 1);
  assert.deepEqual(q.tabsAt({ col: 0, fila: 0 }), ["b", "c"]);
  assert.deepEqual(q.widths(), [1]);
  sano(q);
  // Y una que no estaba repartida entra por `sincronizar` en la activa.
  q.sync(["b", "c", "nueva"]);
  assert.deepEqual(q.siteOf("nueva"), { col: 0, fila: 0 });
  sano(q);
});

test("un reparto guardado roto no deja la rejilla rota", () => {
  const q = createPanels();
  q.restore(
    {
      columnas: [[{ pestanas: ["a"], activa: "fantasma" }]],
      anchos: [2, -1],
      altos: [],
      activo: { col: 9, fila: 9 },
    },
    ["a"],
  );
  assert.deepEqual(q.tabsAt({ col: 0, fila: 0 }), ["a"]);
  assert.equal(q.activeTabAt({ col: 0, fila: 0 }), "a", "una activa inventada no se sostiene");
  assert.deepEqual(q.widths(), [1], "unos anchos que no suman uno se rehacen");
  assert.deepEqual(q.heights(), [1]);
  assert.deepEqual(q.activeSite(), { col: 0, fila: 0 });
  sano(q);
  // Sin nada guardado también queda la rejilla sana.
  q.restore(null, []);
  assert.equal(q.groupCount(), 1);
  sano(q);
});

test("restaurar no repite una pestaña en dos ventanas", () => {
  const q = createPanels();
  q.restore(
    {
      columnas: [[{ pestanas: ["a", "a"], activa: "a" }], [{ pestanas: ["a", "b"], activa: "b" }]],
      anchos: [0.5, 0.5],
      altos: [1],
      activo: { col: 0, fila: 0 },
    },
    ["a", "b"],
  );
  assert.deepEqual(q.tabsAt({ col: 0, fila: 0 }), ["a"]);
  assert.deepEqual(q.tabsAt({ col: 1, fila: 0 }), ["b"], "la repetida se queda en su primera ventana");
  sano(q);
});

test("el reparto se guarda y se lee por workspace y espacio", () => {
  saveLayout("w", "i1", {
    columnas: [[{ pestanas: ["a"], activa: "a" }], [{ pestanas: ["b"], activa: "b" }]],
    anchos: [0.5, 0.5],
    altos: [1],
    activo: { col: 1, fila: 0 },
  });
  assert.deepEqual(readLayout("w", "i1")?.columnas, [
    [{ pestanas: ["a"], activa: "a" }],
    [{ pestanas: ["b"], activa: "b" }],
  ]);
  assert.equal(readLayout("w", "i2"), null, "el reparto de un espacio no es el de otro");
  assert.deepEqual(spacesWithLayout("w"), ["i1"]);
  assert.deepEqual(spacesWithLayout("otro"), []);
  deleteLayout("w", "i1");
  assert.equal(readLayout("w", "i1"), null);
  // Lo escrito sin la forma mínima no se toma por un reparto.
  almacen.set("harness.layout.panels.w.i9", JSON.stringify({ columnas: "no" }));
  assert.equal(readLayout("w", "i9"), null);
  almacen.set("harness.layout.panels.w.i9", "no es json");
  assert.equal(readLayout("w", "i9"), null);
});

test("cada cambio del reparto se guarda bajo el espacio encuadrado", () => {
  const p = con("a", "b");
  p.bindTo("w", "i1");
  assert.deepEqual(readLayout("w", "i1")?.columnas, [[{ pestanas: ["a", "b"], activa: "b" }]]);
  p.split("a");
  assert.equal(readLayout("w", "i1")?.columnas.length, 2, "partir no llegó a lo guardado");
  p.join();
  assert.equal(readLayout("w", "i1")?.columnas.length, 1);
  // Al dejar el espacio deja de escribir: no pisa su reparto con el del que
  // llega, que es lo que rompería el cambio de espacio.
  p.bindTo(null, null);
  p.split("a");
  assert.equal(readLayout("w", "i1")?.columnas.length, 1, "sin encuadrar se pisó lo guardado");
});
