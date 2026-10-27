/**
 * El fondo del chat se reduce por pasos: primero la calidad, luego el lado,
 * hasta 1,5 MB; si ninguno llega, el más liviano mientras no pase de 6 MiB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BACKGROUND_MAX, SHRINK_STEPS, SHRINK_TARGET, ShrinkError, fitWithin, shrinkLadder, type ShrinkStep } from "../../src/lib/shrink-image.ts";

const of = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: "image/webp" });

test("baja la calidad 0,82 → 0,7 → 0,6 en 2560 px y después pasa a 1920 px", () => {
  assert.deepEqual(
    SHRINK_STEPS.map(({ side, quality }) => `${side}@${quality}`),
    ["2560@0.82", "2560@0.7", "2560@0.6", "1920@0.82", "1920@0.7", "1920@0.6"],
  );
});

test("se queda con el primer paso que pesa 1,5 MB o menos", async () => {
  const pedidos: ShrinkStep[] = [];
  const sizes = [3_000_000, 2_000_000, 1_400_000, 900_000];
  const blob = await shrinkLadder(async (step) => {
    pedidos.push(step);
    return of(sizes[pedidos.length - 1]);
  });
  assert.equal(blob.size, 1_400_000);
  assert.deepEqual(pedidos.at(-1), { side: 2560, quality: 0.6 });
  assert.equal(pedidos.length, 3, "no sigue reduciendo después de llegar");
});

test("una imagen que ya cabe no pasa del primer paso", async () => {
  let llamadas = 0;
  const blob = await shrinkLadder(async () => (llamadas++, of(200_000)));
  assert.equal(blob.size, 200_000);
  assert.equal(llamadas, 1);
});

test("si ningún paso llega, sube la más liviana mientras quepa en 6 MiB", async () => {
  const sizes = [5_000_000, 4_000_000, 3_500_000, 2_100_000, 1_900_000, 1_600_000];
  let i = 0;
  const blob = await shrinkLadder(async () => of(sizes[i++]));
  assert.equal(i, SHRINK_STEPS.length);
  assert.equal(blob.size, 1_600_000);
  assert.ok(SHRINK_TARGET < blob.size && blob.size <= BACKGROUND_MAX);
});

test("más de 6 MiB en todos los pasos no se puede reducir; ningún paso codificado no se puede leer", async () => {
  await assert.rejects(shrinkLadder(async () => of(BACKGROUND_MAX + 1)), (e: unknown) => e instanceof ShrinkError && e.code === "too_big");
  await assert.rejects(shrinkLadder(async () => null), (e: unknown) => e instanceof ShrinkError && e.code === "unreadable");
});

test("un tope menor sigue la misma escalera", async () => {
  let i = 0;
  const sizes = [1_200_000, 900_000, 650_000];
  const blob = await shrinkLadder(async () => of(sizes[i++]), 700_000);
  assert.equal(blob.size, 650_000);
});

test("el lado largo baja hasta el paso sin deformar ni agrandar", () => {
  assert.deepEqual(fitWithin(4000, 3000, 2560), { width: 2560, height: 1920 });
  assert.deepEqual(fitWithin(3000, 6000, 1920), { width: 960, height: 1920 });
  assert.deepEqual(fitWithin(800, 600, 2560), { width: 800, height: 600 });
});
