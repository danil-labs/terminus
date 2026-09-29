// Streaming download with a simple progress bar, using Node's native fetch
// (18+). Writes to disk as data arrives so 40+ MB are not loaded into memory.
// No dependencies.

import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

function fmtMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function renderProgress(received, total) {
  if (!process.stderr.isTTY) return; // in logs we don't clutter the output with \r
  const width = 24;
  if (total) {
    const ratio = Math.min(1, received / total);
    const filled = Math.round(ratio * width);
    const bar = '#'.repeat(filled) + '-'.repeat(width - filled);
    process.stderr.write(
      `\r  [${bar}] ${fmtMB(received)} / ${fmtMB(total)} MB (${Math.round(ratio * 100)}%)`
    );
  } else {
    process.stderr.write(`\r  downloading... ${fmtMB(received)} MB`);
  }
}

// Downloads `url` to `destPath`. Returns { bytes }. Throws if HTTP is not 200.
export async function downloadToFile(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status} ${res.statusText} at ${url}`);
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
    throw new Error(`incomplete download: ${received} of ${total} bytes`);
  }
  return { bytes: received };
}

// Downloads a small text resource (latest.json, .sig).
export async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`could not read ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}
