#!/usr/bin/env node
// npx @danil-labs/terminus — installs Terminus (Danil desktop app) with one
// command. A channel for developers (who already have Node), in addition to the
// .exe that is downloaded by hand.
//
// Flow: detect OS/architecture -> resolve the asset in the PUBLIC releases of
// danil-labs/terminus via latest.json -> download -> VERIFY minisign (not
// optional: we download and run a native binary) -> run the installer. If
// verification fails, it deletes the download and exits with an error.
//
// No dependencies: native fetch/crypto/child_process from Node 18+.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

import { detectPlatform } from './lib/platform.mjs';
import { downloadToFile, fetchText } from './lib/download.mjs';
import { verifyFile } from './lib/minisign.mjs';

// Terminus minisign public key. Identical to the one embedded in the app
// (harness-app/terminus-app -> src-tauri/tauri.conf.json -> plugins.updater.pubkey).
// It is public by design; it seals that the installer came from Danil.
const PUBKEY_B64 =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDM5ODEzRDE1M0QwQ0RFQjgKUldTNDNndzlGVDJCT1hPSnp4ZzBIbkowOW9kVGFYb0YyRkZKZjNTT2N3eERXOXhuRi9UblY5d3EK';

const LATEST_JSON_URL = 'https://github.com/danil-labs/terminus/releases/latest/download/latest.json';
const MANUAL_DOWNLOAD_URL = 'https://terminus.danil.ai';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const paint = (color, s) => (process.stdout.isTTY ? `${color}${s}${C.reset}` : s);
const log = (s = '') => console.log(s);
const err = (s = '') => console.error(s);

function parseArgs(argv) {
  const args = { dryRun: false, help: false };
  for (const a of argv) {
    if (a === '--dry-run' || a === '-n') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  log(`${paint(C.bold, 'Terminus')} — installer via npx

  Usage:
    npx @danil-labs/terminus [options]

  Options:
    -n, --dry-run   Downloads and verifies, but does NOT run the installer.
    -h, --help      Shows this help.

  What it does:
    1. Detects your operating system and architecture.
    2. Resolves the right artifact from the public Terminus releases.
    3. Downloads it to a temporary folder.
    4. Verifies its minisign signature before running or copying anything.
    5. Windows: launches the installer. macOS: unpacks the app and places it in
       /Applications. From then on, it updates itself.

  Manual download: ${MANUAL_DOWNLOAD_URL}`);
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(filePath).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function runWindowsInstaller(exePath) {
  // NSIS in normal (interactive) mode. It is launched detached so this npx
  // process can exit while the installer stays on screen.
  const child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
  child.unref();
}

// On macOS what the release publishes is NOT an installer: it is the compressed
// `.app` — the same artifact the app uses to update itself. There is nothing to
// run, so installing here means unpacking it and putting it in place. Leaving it
// as "I've downloaded it, open it yourself" would hand someone a `.tar.gz` in a
// temporary folder, which doesn't open by double-clicking and which deletes
// itself.
//
// **And this path skips the "unverified developer" dialog.** Quarantine is set
// by whoever downloads — the browser — not by the file: downloaded with `fetch`
// and unpacked with `tar`, the `.app` is born without that attribute. The
// website's DMG does carry it. It is this channel's real advantage, not a
// shortcut: the signature was checked above against the same key the app uses,
// and without it we never get here.
function installMacApp(tarPath, tmpDir) {
  const destinos = [
    '/Applications',
    path.join(os.homedir(), 'Applications'),
  ];

  const correr = (cmd, cmdArgs) => {
    const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(
        `${cmd} ${cmdArgs.join(' ')} → ${r.status}\n  ${(r.stderr || '').trim()}`
      );
    }
    return r;
  };

  log(`\n${paint(C.bold, 'Installing')}`);
  correr('tar', ['-xzf', tarPath, '-C', tmpDir]);

  const bundle = fs
    .readdirSync(tmpDir)
    .find((n) => n.endsWith('.app'));
  if (!bundle) {
    err(paint(C.red, '\n  The archive contained no app.'));
    err(paint(C.dim, `  Contents: ${fs.readdirSync(tmpDir).join(', ')}`));
    process.exit(1);
  }
  const origen = path.join(tmpDir, bundle);

  // Copying over a running app swaps its binary out from under it and kills it
  // mid-task. We check by path and not by name: the executable inside isn't
  // named like the bundle.
  for (const dir of destinos) {
    const destino = path.join(dir, bundle);
    if (!fs.existsSync(destino)) continue;
    const ps = spawnSync('ps', ['-Ao', 'comm='], { encoding: 'utf8' });
    if ((ps.stdout || '').split('\n').some((l) => l.startsWith(`${destino}/`))) {
      err(paint(C.yellow, `\n  ${bundle} is open.`));
      err('  Close it and run this again — installing over it would kill it mid-task.');
      process.exit(1);
    }
  }

  let puesta = null;
  let ultimoFallo = null;
  for (const dir of destinos) {
    const destino = path.join(dir, bundle);
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Replace, don't merge: a `cp` on top leaves behind the old version's
      // files that the new one no longer ships, and a half-and-half bundle fails
      // to start in a way that can't be diagnosed.
      fs.rmSync(destino, { recursive: true, force: true });
      correr('ditto', [origen, destino]);
      puesta = destino;
      break;
    } catch (e) {
      // `/Applications` asks for permission on some machines. We fall back to
      // the user's folder instead of asking for sudo: installing an app
      // shouldn't require an administrator, and asking for one teaches people to
      // grant it to anything.
      ultimoFallo = e;
    }
  }

  if (!puesta) {
    err(paint(C.red, `\n  Could not install.\n  ${ultimoFallo?.message ?? ''}`));
    process.exit(1);
  }

  log(paint(C.green, `\n✓ Installed at ${puesta}`));
  log(paint(C.dim, '  From now on, Terminus updates itself from inside the app.'));
  spawnSync('open', [puesta]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  if (typeof fetch !== 'function') {
    err(paint(C.red, 'You need Node 18 or later (native fetch is missing).'));
    process.exit(1);
  }

  log(paint(C.bold, 'Terminus') + paint(C.dim, ' · installer'));

  const plat = detectPlatform();
  log(`  System:     ${plat.label}  ${paint(C.dim, `(${plat.platform}/${plat.arch})`)}`);

  // 1) Release manifest. It is the source of truth for version, asset URL and
  //    signature — and it is cross-platform by design.
  let manifest;
  try {
    manifest = JSON.parse(await fetchText(LATEST_JSON_URL));
  } catch (e) {
    err(paint(C.red, `\nCould not read the latest version's information.\n  ${e.message}`));
    process.exit(1);
  }

  const entry = plat.key ? manifest.platforms?.[plat.key] : null;
  if (!entry) {
    // We don't pretend to support what doesn't exist.
    err(
      paint(C.yellow, `\nThere is no build for ${plat.label} yet.`) +
        `\nDownload it by hand at ${paint(C.cyan, MANUAL_DOWNLOAD_URL)} once it is available.`
    );
    process.exit(1);
  }

  const version = manifest.version || '(unknown)';
  const installerUrl = entry.url;
  const signatureB64 = entry.signature;
  const expectedFileName = path.basename(new URL(installerUrl).pathname);
  log(`  Version:    ${version}`);

  if (!installerUrl || !signatureB64) {
    err(paint(C.red, '\nThe release manifest is incomplete (missing url or signature).'));
    process.exit(1);
  }

  // 2) Download to a temporary folder.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'danil-terminus-'));
  const installerPath = path.join(tmpDir, expectedFileName);
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };

  log(`\n${paint(C.bold, 'Downloading')} ${expectedFileName}`);
  try {
    await downloadToFile(installerUrl, installerPath);
  } catch (e) {
    cleanup();
    err(paint(C.red, `\nDownload failed.\n  ${e.message}`));
    process.exit(1);
  }

  // 3) INTEGRITY VERIFICATION — mandatory. If it fails, nothing is run.
  log(`\n${paint(C.bold, 'Verifying signature')} ${paint(C.dim, '(minisign · BLAKE2b-512 + Ed25519)')}`);
  try {
    const info = await verifyFile({
      filePath: installerPath,
      sigFileB64: signatureB64,
      publicKeyB64: PUBKEY_B64,
      expectedFileName,
    });
    const sha = await sha256File(installerPath);
    log(paint(C.green, '  ✓ Valid signature') + paint(C.dim, ` (keyId ${info.keyId})`));
    log(paint(C.dim, `  sha256: ${sha}`));
  } catch (e) {
    cleanup();
    err(paint(C.red, `\n  ✗ VERIFICATION FAILED — the installer is not run.\n  ${e.message}`));
    err(paint(C.dim, '  The download was deleted.'));
    process.exit(1);
  }

  // 4) Run (or stop on dry-run).
  if (args.dryRun) {
    log(paint(C.yellow, '\n--dry-run: download verified, the installer is not run.'));
    log(paint(C.dim, `  Installer at: ${installerPath}`));
    return; // the file is left in place for manual inspection on dry-run
  }

  if (plat.installerKind === 'windows-nsis') {
    log(`\n${paint(C.bold, 'Running the installer')}...`);
    runWindowsInstaller(installerPath);
    log(paint(C.green, '\n✓ Installer launched.') + ' Follow the steps on screen.');
    log(paint(C.dim, '  From now on, Terminus updates itself from inside the app.'));
  } else if (plat.installerKind === 'macos') {
    installMacApp(installerPath, tmpDir);
  } else {
    // Platform resolved in latest.json but with no automatic execution here.
    log(paint(C.green, `\n✓ Downloaded and verified: ${installerPath}`));
    log('  Open it to complete the installation.');
  }
}

main().catch((e) => {
  err(paint(C.red, `\nUnexpected error: ${e?.stack || e}`));
  process.exit(1);
});
