import assert from "node:assert/strict";
import test from "node:test";
import { CHUNK, chunkIds, chunkOf, tailChunk } from "../src/features/chat/threadWindow.ts";

test("abrir uno largo monta sus dos últimos tramos, y el último puede ir a medias", () => {
  const total = 10 * CHUNK + 3;
  const first = tailChunk(total);
  assert.deepEqual(chunkIds(total, first), [9, 10]);
  const shown = chunkIds(total, first).flatMap((id) => chunkOf([...Array(total).keys()], id));
  assert.equal(shown.at(-1), total - 1, "el último bloque siempre está montado");
  assert.ok(shown.length > CHUNK && shown.length <= 2 * CHUNK);
});

test("si el hilo encoge por debajo de lo montado, el último tramo sigue a la vista", () => {
  assert.deepEqual(chunkIds(CHUNK, 4), [0]);
});
