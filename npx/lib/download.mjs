// Descarga por streaming con barra de progreso simple, usando fetch nativo de
// Node (18+). Escribe a disco a medida que llega para no cargar 40+ MB en
// memoria. Sin dependencias.

import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { t } from './i18n.mjs';

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
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(t('httpDownload', { status: `${res.status} ${res.statusText}`.trim(), url }));
  }
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;

  const nodeStream = Readable.fromWeb(res.body);
  nodeStream.on('data', (chunk) => {
    received += chunk.length;
    renderProgress(received, total);
  });

  await pipeline(nodeStream, fs.createWriteStream(destPath));
  if (process.stderr.isTTY) process.stderr.write('\n');

  if (total && received !== total) {
    throw new Error(t('incompleteDownload', { received, total }));
  }
  return { bytes: received };
}

// Descarga un recurso de texto pequeño (latest.json, .sig).
export async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(t('httpRead', { url, status: `${res.status} ${res.statusText}`.trim() }));
  }
  return res.text();
}
