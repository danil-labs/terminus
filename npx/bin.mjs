#!/usr/bin/env node
// npx @soydanil/terminus — instala Terminus (app de escritorio Danil) con un
// comando. Canal para desarrolladores (que ya tienen Node), adicional al .exe
// que se descarga a mano.
//
// Flujo: detecta SO/arquitectura -> resuelve el asset en las releases PÚBLICAS
// de soydanil/terminus vía latest.json -> descarga -> VERIFICA minisign (no
// opcional: descargamos y ejecutamos un binario nativo) -> ejecuta el
// instalador. Si la verificación falla, borra la descarga y sale con error.
//
// Sin dependencias: fetch/crypto/child_process nativos de Node 18+.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

import { detectPlatform } from './lib/platform.mjs';
import { downloadToFile, fetchText } from './lib/download.mjs';
import { verifyFile } from './lib/minisign.mjs';

// Clave pública minisign de Terminus. Idéntica a la embebida en la app
// (harness-app/terminus-app -> src-tauri/tauri.conf.json -> plugins.updater.pubkey).
// Es pública por diseño; sella que el instalador salió de Danil.
const PUBKEY_B64 =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDM5ODEzRDE1M0QwQ0RFQjgKUldTNDNndzlGVDJCT1hPSnp4ZzBIbkowOW9kVGFYb0YyRkZKZjNTT2N3eERXOXhuRi9UblY5d3EK';

const LATEST_JSON_URL = 'https://github.com/soydanil/terminus/releases/latest/download/latest.json';
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
  log(`${paint(C.bold, 'Terminus')} — instalador vía npx

  Uso:
    npx @soydanil/terminus [opciones]

  Opciones:
    -n, --dry-run   Descarga y verifica, pero NO ejecuta el instalador.
    -h, --help      Muestra esta ayuda.

  Qué hace:
    1. Detecta tu sistema operativo y arquitectura.
    2. Resuelve el artefacto correcto de las releases públicas de Terminus.
    3. Lo descarga a una carpeta temporal.
    4. Verifica su firma minisign antes de ejecutar ni copiar nada.
    5. Windows: lanza el instalador. macOS: descomprime la app y la deja en
       /Applications. A partir de ahí, se actualiza sola.

  Descarga manual: ${MANUAL_DOWNLOAD_URL}`);
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(filePath).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function runWindowsInstaller(exePath) {
  // NSIS en modo normal (interactivo). Se lanza desprendido para que este
  // proceso de npx pueda salir mientras el instalador sigue en pantalla.
  const child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
  child.unref();
}

// En macOS lo que publica la release NO es un instalador: es el `.app`
// comprimido —el mismo artefacto que la app usa para actualizarse sola—. No hay
// nada que ejecutar, así que instalar aquí es descomprimirlo y ponerlo en su
// sitio. Dejarlo como «ya lo descargué, ábrelo tú» sería devolverle a alguien un
// `.tar.gz` en una carpeta temporal, que no se abre haciendo doble clic y que se
// borra sola.
//
// **Y esta ruta se salta el diálogo de «desarrollador no verificado».** La
// cuarentena la pone quien descarga —el navegador—, no el archivo: bajado con
// `fetch` y descomprimido con `tar`, el `.app` nace sin ese atributo. El DMG de
// la página sí lo lleva. Es la ventaja real de este canal, no un atajo: la firma
// se comprobó arriba contra la misma llave que usa la app, y sin ella no se
// llega hasta aquí.
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

  log(`\n${paint(C.bold, 'Instalando')}`);
  correr('tar', ['-xzf', tarPath, '-C', tmpDir]);

  const bundle = fs
    .readdirSync(tmpDir)
    .find((n) => n.endsWith('.app'));
  if (!bundle) {
    err(paint(C.red, '\n  El archivo no traía ninguna app dentro.'));
    err(paint(C.dim, `  Contenido: ${fs.readdirSync(tmpDir).join(', ')}`));
    process.exit(1);
  }
  const origen = path.join(tmpDir, bundle);

  // Copiar encima de una app abierta le cambia el binario por debajo y la mata
  // a mitad de lo que esté haciendo. Se mira por ruta y no por nombre: el
  // ejecutable de dentro no se llama como el bundle.
  for (const dir of destinos) {
    const destino = path.join(dir, bundle);
    if (!fs.existsSync(destino)) continue;
    const ps = spawnSync('ps', ['-Ao', 'comm='], { encoding: 'utf8' });
    if ((ps.stdout || '').split('\n').some((l) => l.startsWith(`${destino}/`))) {
      err(paint(C.yellow, `\n  ${bundle} está abierta.`));
      err('  Ciérrala y repite — instalar encima la mataría a mitad de lo que esté haciendo.');
      process.exit(1);
    }
  }

  let puesta = null;
  let ultimoFallo = null;
  for (const dir of destinos) {
    const destino = path.join(dir, bundle);
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Reemplazo y no fusión: un `cp` encima deja los archivos de la versión
      // vieja que la nueva ya no trae, y un bundle mitad y mitad no arranca de
      // una forma que se pueda diagnosticar.
      fs.rmSync(destino, { recursive: true, force: true });
      correr('ditto', [origen, destino]);
      puesta = destino;
      break;
    } catch (e) {
      // `/Applications` pide permiso en algunas máquinas. Se cae a la carpeta
      // del usuario en vez de pedir sudo: instalar una app no debería exigir
      // administrador, y pedirlo enseña a dárselo a cualquier cosa.
      ultimoFallo = e;
    }
  }

  if (!puesta) {
    err(paint(C.red, `\n  No se pudo instalar.\n  ${ultimoFallo?.message ?? ''}`));
    process.exit(1);
  }

  log(paint(C.green, `\n✓ Instalada en ${puesta}`));
  log(paint(C.dim, '  A partir de ahora, Terminus se actualiza sola desde dentro de la app.'));
  spawnSync('open', [puesta]);
}


function installLinuxAppImage(srcPath) {
  const appsDir = path.join(os.homedir(), 'Applications');
  const dest = path.join(appsDir, 'Terminus.AppImage');
  const binLink = path.join(os.homedir(), '.local', 'bin', 'terminus');
  log(`\n${paint(C.bold, 'Instalando')}`);
  fs.mkdirSync(appsDir, { recursive: true });
  fs.mkdirSync(path.dirname(binLink), { recursive: true });
  fs.copyFileSync(srcPath, dest);
  fs.chmodSync(dest, 0o755);
  try { fs.symlinkSync(dest, binLink); } catch (e) {
    if (e && e.code === 'EEXIST') {
      fs.unlinkSync(binLink);
      fs.symlinkSync(dest, binLink);
    } else {
      throw e;
    }
  }
  log(paint(C.green, `\n✓ Instalada en ${dest}`));
  log(paint(C.dim, '  También en ~/.local/bin/terminus (si ese directorio está en tu PATH).'));
  log(paint(C.dim, '  A partir de ahora, Terminus se actualiza sola desde dentro de la app.'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  if (typeof fetch !== 'function') {
    err(paint(C.red, 'Necesitas Node 18 o superior (falta fetch nativo).'));
    process.exit(1);
  }

  log(paint(C.bold, 'Terminus') + paint(C.dim, ' · instalador'));

  const plat = detectPlatform();
  log(`  Sistema:    ${plat.label}  ${paint(C.dim, `(${plat.platform}/${plat.arch})`)}`);

  // 1) Manifiesto de la release. Es la fuente de verdad de versión, URL del
  //    asset y firma — y es multiplataforma por diseño.
  let manifest;
  try {
    manifest = JSON.parse(await fetchText(LATEST_JSON_URL));
  } catch (e) {
    err(paint(C.red, `\nNo se pudo leer la información de la última versión.\n  ${e.message}`));
    process.exit(1);
  }

  const entry = plat.key ? manifest.platforms?.[plat.key] : null;
  if (!entry) {
    // No fingimos soporte que no existe.
    err(
      paint(C.yellow, `\nTodavía no hay build para ${plat.label}.`) +
        `\nDescárgalo a mano en ${paint(C.cyan, MANUAL_DOWNLOAD_URL)} cuando esté disponible.`
    );
    process.exit(1);
  }

  const version = manifest.version || '(desconocida)';
  const installerUrl = entry.url;
  const signatureB64 = entry.signature;
  const expectedFileName = path.basename(new URL(installerUrl).pathname);
  log(`  Versión:    ${version}`);

  if (!installerUrl || !signatureB64) {
    err(paint(C.red, '\nEl manifiesto de la release está incompleto (falta url o firma).'));
    process.exit(1);
  }

  // 2) Descarga a temporal.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'danil-terminus-'));
  const installerPath = path.join(tmpDir, expectedFileName);
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };

  log(`\n${paint(C.bold, 'Descargando')} ${expectedFileName}`);
  try {
    await downloadToFile(installerUrl, installerPath);
  } catch (e) {
    cleanup();
    err(paint(C.red, `\nDescarga falló.\n  ${e.message}`));
    process.exit(1);
  }

  // 3) VERIFICACIÓN DE INTEGRIDAD — obligatoria. Si falla, no se ejecuta nada.
  log(`\n${paint(C.bold, 'Verificando firma')} ${paint(C.dim, '(minisign · BLAKE2b-512 + Ed25519)')}`);
  try {
    const info = await verifyFile({
      filePath: installerPath,
      sigFileB64: signatureB64,
      publicKeyB64: PUBKEY_B64,
      expectedFileName,
    });
    const sha = await sha256File(installerPath);
    log(paint(C.green, '  ✓ Firma válida') + paint(C.dim, ` (keyId ${info.keyId})`));
    log(paint(C.dim, `  sha256: ${sha}`));
  } catch (e) {
    cleanup();
    err(paint(C.red, `\n  ✗ VERIFICACIÓN FALLIDA — no se ejecuta el instalador.\n  ${e.message}`));
    err(paint(C.dim, '  La descarga fue borrada.'));
    process.exit(1);
  }

  // 4) Ejecutar (o parar en dry-run).
  if (args.dryRun) {
    log(paint(C.yellow, '\n--dry-run: descarga verificada, no se ejecuta el instalador.'));
    log(paint(C.dim, `  Instalador en: ${installerPath}`));
    return; // se deja el archivo para inspección manual en dry-run
  }

  if (plat.installerKind === 'windows-nsis') {
    log(`\n${paint(C.bold, 'Ejecutando el instalador')}...`);
    runWindowsInstaller(installerPath);
    log(paint(C.green, '\n✓ Instalador lanzado.') + ' Sigue los pasos en pantalla.');
    log(paint(C.dim, '  A partir de ahora, Terminus se actualiza solo desde dentro de la app.'));
  } else if (plat.installerKind === 'macos') {
    installMacApp(installerPath, tmpDir);
  } else if (plat.installerKind === 'linux') {
    installLinuxAppImage(installerPath);
  } else {
    // Plataforma resuelta en latest.json pero sin ejecución automática aquí.
    log(paint(C.green, `\n✓ Descargado y verificado: ${installerPath}`));
    log('  Ábrelo para completar la instalación.');
  }
}

main().catch((e) => {
  err(paint(C.red, `\nError inesperado: ${e?.stack || e}`));
  process.exit(1);
});
