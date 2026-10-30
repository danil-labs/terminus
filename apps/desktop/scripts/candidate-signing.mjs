// Valida entradas fijadas y firmas; no obtiene credenciales ni publica.
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, readlink, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyFile } from '../npx/lib/minisign.mjs';

const [command, input, platform, sourceOid] = process.argv.slice(2);
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const relative = value => typeof value === 'string' && value !== '' &&
  !/[\\:\x00-\x1f]/.test(value) && !value.split('/').some(part => part === '..' || part === '' || part === '.') &&
  !path.isAbsolute(value) && !/^[a-z]:/i.test(value);

if (command === 'validate') {
  if (!['windows', 'macos', 'linux'].includes(platform)) fail('Unsupported platform');
  const directory = await realpath(input);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(sourceOid ?? '') || manifest.source_oid !== sourceOid ||
      manifest.platform !== platform || manifest.version !== '0.3.0-rc.1') fail('Provenance mismatch');
  const files = manifest.files;
  const links = manifest.links ?? {};
  if (!files || Array.isArray(files) || typeof files !== 'object') fail('Missing file inventory');
  for (const name of [...Object.keys(files), ...Object.keys(links)]) {
    if (!relative(name) || name === 'manifest.json') fail('Invalid inventory path');
  }
  const seen = new Set();
  async function walk(directoryName) {
    for (const entry of await readdir(directoryName)) {
      const full = path.join(directoryName, entry);
      const name = path.relative(directory, full).split(path.sep).join('/');
      if (name === 'manifest.json') continue;
      const stat = await lstat(full);
      if (stat.isDirectory()) { await walk(full); continue; }
      if (stat.isSymbolicLink()) {
        if (links[name] !== await readlink(full)) fail(`Unlisted symlink: ${name}`);
        const target = await realpath(full);
        if (!target.startsWith(directory + path.sep)) fail(`External symlink: ${name}`);
      } else if (stat.isFile()) {
        if (!/^[a-f0-9]{64}$/.test(files[name] ?? '') || hash(await readFile(full)) !== files[name]) fail(`Hash mismatch: ${name}`);
      } else fail(`Unsupported file type: ${name}`);
      seen.add(name);
    }
  }
  await walk(directory);
  for (const name of [...Object.keys(files), ...Object.keys(links)]) if (!seen.has(name)) fail(`Missing input: ${name}`);
  const required = platform === 'windows' ? ['main', 'engine', 'nsis_script', 'installer'] : platform === 'macos' ? ['app', 'dmg'] : ['appimage'];
  for (const key of required) if (!relative(manifest[key])) fail(`Missing relative role: ${key}`);
  if (platform === 'windows') {
    if (!/^[a-f0-9]{64}$/.test(manifest.makensis_sha256 ?? '')) fail('Missing NSIS toolchain hash');
    for (const key of ['main', 'engine', 'nsis_script']) if (!files[manifest[key]]) fail(`Role not inventoried: ${key}`);
    if (seen.has(manifest.installer)) fail('Installer output must not exist in input');
    if (/work-tools/i.test(manifest.main + manifest.engine)) fail('Cannot sign work-tools');
    if (path.basename(manifest.main) !== 'terminus.exe' ||
        !/^seldon-runtime(?:-x86_64-pc-windows-msvc)?\.exe$/.test(path.basename(manifest.engine))) fail('Unexpected executable roles');
  } else if (platform === 'macos') {
    if (manifest.app !== 'Terminus.app' || manifest.dmg !== 'template.dmg' || !files[manifest.dmg]) fail('Unexpected macOS layout');
  } else if (!files[manifest.appimage] || !manifest.appimage.endsWith('.AppImage')) fail('AppImage not inventoried');
  console.log(`Validated ${seen.size} input files/links for ${sourceOid}`);
} else if (command === 'verify') {
  const config = JSON.parse(await readFile(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  await verifyFile({filePath: input, sigFileB64: await readFile(input + '.sig', 'utf8'),
    publicKeyB64: config.plugins.updater.pubkey, expectedFileName: path.basename(input)});
  const manifest = JSON.parse(await readFile('candidate/manifest.json', 'utf8'));
  const receipt = {source_oid: manifest.source_oid, version: manifest.version, platform: manifest.platform,
    signing_workflow_oid: process.env.GITHUB_SHA ?? null, input_release: process.env.INPUT_RELEASE ?? null,
    input_sha256: process.env.INPUT_SHA256 ?? null,
    output: path.basename(input), sha256: hash(await readFile(input)), updater_signature_verified: true,
    installed_qa: 'pending', release_published: false};
  await writeFile(path.join(path.dirname(input), 'signing-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log('Updater signature matches installed public key');
} else fail('Expected validate or verify');
