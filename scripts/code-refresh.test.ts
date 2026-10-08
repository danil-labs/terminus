import assert from "node:assert/strict";
import test from "node:test";

import { comoEntra, decidir } from "../src/features/code/refresh.ts";

/**
 * **Las dos decisiones de editar el mismo árbol que el agente.**
 *
 * La persona y el agente escriben a la vez a propósito —es el modelo de un IDE
 * agéntico, y el CLI relee el disco en cada turno—, así que lo que decide si eso
 * es seguro es qué hace el panel cuando el archivo se mueve por debajo. Ninguno
 * de los dos fallos da un error:
 *
 * - **No refrescar** deja la versión vieja en pantalla, y guardar la escribe
 *   entera encima de lo que el agente acaba de hacer.
 * - **Refrescar encima de lo escrito** borra lo que alguien estaba tecleando.
 *
 * Y el tercero es de coste: refrescar ocho pestañas escondidas en cada turno son
 * dieciséis pasadas de git que nadie ve.
 */

test("con nada escrito, el refresco entra", () => {
  assert.equal(comoEntra(false, false), "entra");
});

/**
 * Se entró a editar y no se ha tocado nada: el borrador es el archivo. Dejarlo
 * con la versión vieja dentro del editor es justo el accidente que esto cierra
 * — quien tiene el cursor puesto está a punto de guardar eso.
 */
test("editando sin tocar nada, el refresco arrastra el borrador", () => {
  assert.equal(comoEntra(true, false), "arrastra");
});

/** Y con algo escrito no entra: avisa. Pisarlo es el mismo defecto al revés. */
test("con algo escrito sin guardar, avisa en vez de pisar", () => {
  assert.equal(comoEntra(true, true), "avisa");
});

test("la pestaña que se está mirando lee al llegar la señal", () => {
  assert.deepEqual(
    decidir({ mio: true, visible: true, pendiente: false }, "aviso"),
    { pendiente: false, refrescar: true },
  );
});

/** Escondida no lee: se apunta. Es el punto entero del coste. */
test("una pestaña escondida apunta la señal y no lee", () => {
  assert.deepEqual(
    decidir({ mio: true, visible: false, pendiente: false }, "aviso"),
    { pendiente: true, refrescar: false },
  );
});

/** Y la cobra al pasar a primer plano, **una sola vez**. */
test("al asomarse cobra lo apuntado, y solo una vez", () => {
  const primera = decidir({ mio: true, visible: true, pendiente: true }, "asoma");
  assert.deepEqual(primera, { pendiente: false, refrescar: true });
  assert.deepEqual(
    decidir({ mio: true, visible: true, pendiente: primera.pendiente }, "asoma"),
    { pendiente: false, refrescar: false },
  );
});

/**
 * El turno de otra tarea no toca esta. Con varias pestañas de tarea abiertas,
 * los eventos de todas llegan a todos los paneles.
 */
test("el turno de otra tarea no la hace leer ni la deja apuntada", () => {
  assert.deepEqual(
    decidir({ mio: false, visible: true, pendiente: false }, "aviso"),
    { pendiente: false, refrescar: false },
  );
});
