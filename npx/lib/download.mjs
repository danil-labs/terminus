// Descarga por streaming con barra de progreso simple, usando fetch nativo de
// Node (18+). Escribe a disco a medida que llega para no cargar 40+ MB en
// memoria. Sin dependencias.

import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { t } from './i18n.mjs';

// Cuánto puede pasar sin que llegue un byte antes de darse por caída la red.
// Mide silencio, no duración total: un tope total cortaría el instalador en
// una conexión lenta que sí avanza.
const STALL_MS = 30_000;

// Un AbortController que vence tras `ms` de silencio; `touch()` reinicia la
// cuenta cada vez que llega algo.
function stallGuard(ms) {
  const controller = new AbortController();
  let timer;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), ms);
  };
  touch();
  return { signal: controller.signal, touch, done: () => clearTimeout(timer) };
}

// Sin esto, un socket congelado deja `npx` esperando para siempre sin decir nada.
async function guarded(url, guard, run) {
  try {
    return await run();
  } catch (e) {
    if (guard.signal.aborted) {
      throw new Error(t('stalled', { url, seconds: STALL_MS / 1000 }));
    }
    throw e;
  } finally {
    guard.done();
  }
}

function fmtMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function renderProgress(received, total) {
  if (!process.stderr.isTTY) return; // en logs no ensuciamos con \r
  const width = 24;
  if (total) {
    const ratio = Math.min(1, received / total);
    const filled = Math.round(ratio * width);
    const bar = '#'.repeat(filled) + '-'.repeat(width - filled);
    process.stderr.write(
      `\r  [${bar}] ${fmtMB(received)} / ${fmtMB(total)} MB (${Math.round(ratio * 100)}%)`
    );
  } else {
    process.stderr.write(t('downloadingProgress', { mb: fmtMB(received) }));
  }
}

// Descarga `url` a `destPath`. Devuelve { bytes }. Lanza si el HTTP no es 200.
export async function downloadToFile(url, destPath) {
  const guard = stallGuard(STALL_MS);
  return guarded(url, guard, async () => {
    const res = await fetch(url, { redirect: 'follow', signal: guard.signal });
    if (!res.ok) {
      throw new Error(t('httpDownload', { status: `${res.status} ${res.statusText}`.trim(), url }));
    }
    const total = Number(res.headers.get('content-length')) || 0;
    let received = 0;

    const nodeStream = Readable.fromWeb(res.body);
    nodeStream.on('data', (chunk) => {
      guard.touch();
      received += chunk.length;
      renderProgress(received, total);
    });

    await pipeline(nodeStream, fs.createWriteStream(destPath), { signal: guard.signal });
    if (process.stderr.isTTY) process.stderr.write('\n');

    if (total && received !== total) {
      throw new Error(t('incompleteDownload', { received, total }));
    }
    return { bytes: received };
  });
}

// Descarga un recurso de texto pequeño (latest.json, .sig).
export async function fetchText(url) {
  const guard = stallGuard(STALL_MS);
  return guarded(url, guard, async () => {
    const res = await fetch(url, { redirect: 'follow', signal: guard.signal });
    if (!res.ok) {
      throw new Error(t('httpRead', { url, status: `${res.status} ${res.statusText}`.trim() }));
    }
    return res.text();
  });
}
