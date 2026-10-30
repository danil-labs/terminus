// Valida entradas fijadas y firmas; no obtiene credenciales ni publica.
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, readlink, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyFile } from '../npx/lib/minisign.mjs';

const [command, input, platform, sourceOid, windowsMode] = process.argv.slice(2);
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const UPDATER_PUBKEY_SHA256 = 'dd20ff2f22272128f403eb4ab852c00890bdc8aae0e70f3fb4c62ec2d031022a';
const relative = value => typeof value === 'string' && value !== '' &&
  !/[\\:\x00-\x1f]/.test(value) && !value.split('/').some(part => part === '..' || part === '' || part === '.') &&
  !path.isAbsolute(value) && !/^[a-z]:/i.test(value);

async function validateInventory(directory, files, links, canonicalApplicationsLink = false, directories = null) {
  if (!files || Array.isArray(files) || typeof files !== 'object' || !links || Array.isArray(links) || typeof links !== 'object') fail('Missing inventory');
  const names = [...Object.keys(files), ...Object.keys(links)];
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length) fail('Overlapping/aliased files and links');
  for (const name of names) if (!relative(name)) fail('Invalid inventory path');
  const seen = new Set();
  const seenDirectories = new Set();
  if (canonicalApplicationsLink && (!Array.isArray(directories) || directories.some(name => !relative(name)) || new Set(directories).size !== directories.length)) fail('Missing/invalid directory inventory');
  async function walk(directoryName) {
    for (const entry of await readdir(directoryName)) {
      const full = path.join(directoryName, entry);
      const name = path.relative(directory, full).split(path.sep).join('/');
      if (name === 'manifest.json' && !canonicalApplicationsLink) continue;
      const stat = await lstat(full);
      if (stat.isDirectory()) { seenDirectories.add(name); await walk(full); continue; }
      if (stat.isSymbolicLink()) {
        if (Object.hasOwn(files, name) || !Object.hasOwn(links, name) || links[name] !== await readlink(full)) fail(`Unlisted symlink: ${name}`);
        if (!(canonicalApplicationsLink && name === 'Applications' && links[name] === '/Applications')) {
          const target = await realpath(full);
          if (!target.startsWith(directory + path.sep)) fail(`External symlink: ${name}`);
        }
      } else if (stat.isFile()) {
        if (!Object.hasOwn(files, name) || Object.hasOwn(links, name) || !/^[a-f0-9]{64}$/.test(files[name]) || hash(await readFile(full)) !== files[name]) fail(`Hash mismatch: ${name}`);
      } else fail(`Unsupported file type: ${name}`);
      seen.add(name);
    }
  }
  await walk(directory);
  for (const name of names) if (!seen.has(name)) fail(`Missing input: ${name}`);
  if (canonicalApplicationsLink && (directories.length !== seenDirectories.size || directories.some(name => !seenDirectories.has(name)))) fail('Directory inventory mismatch');
  return seen;
}

async function regularRole(directory, files, links, name) {
  if (!relative(name) || !Object.hasOwn(files, name) || Object.hasOwn(links, name)) fail('Role must be an inventoried regular file');
  const full = path.join(directory, name);
  if (!(await lstat(full)).isFile() || await realpath(full) !== full) fail('Role must resolve directly to a regular file');
  if (hash(await readFile(full)) !== files[name]) fail('Role hash mismatch');
}

if (command === 'validate') {
  if (!['windows', 'macos', 'linux'].includes(platform)) fail('Unsupported platform');
  const directory = await realpath(input);
  if (!(await lstat(path.join(directory, 'manifest.json'))).isFile() || await realpath(path.join(directory, 'manifest.json')) !== path.join(directory, 'manifest.json')) fail('Manifest must be a regular file');
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(sourceOid ?? '') || manifest.source_oid !== sourceOid ||
      manifest.platform !== platform || manifest.version !== '0.3.0-rc.1') fail('Provenance mismatch');
  const files = manifest.files;
  const links = manifest.links ?? {};
  if (Object.hasOwn(files ?? {}, 'manifest.json') || Object.hasOwn(links, 'manifest.json')) fail('Manifest cannot inventory itself');
  const seen = await validateInventory(directory, files, links);
  const mode = windowsMode ?? 'internals';
  if (platform === 'windows' && (!['internals', 'installer'].includes(mode) || manifest.windows_mode !== mode)) fail('Windows phase mismatch');
  const required = platform === 'windows' ? (mode === 'internals' ? ['main', 'engine'] : ['installer']) : platform === 'macos' ? ['app', 'dmg'] : ['appimage'];
  for (const key of required) if (!relative(manifest[key])) fail(`Missing relative role: ${key}`);
  if (platform === 'windows') {
    for (const key of required) await regularRole(directory, files, links, manifest[key]);
    if (Object.keys(links).length || Object.keys(files).length !== required.length) fail('Windows ZIP accepts only the signing roles; no packaging scripts');
    if (mode === 'internals' && (/work-tools/i.test(manifest.main + manifest.engine) || path.basename(manifest.main) !== 'terminus.exe' ||
        !/^seldon-runtime(?:-x86_64-pc-windows-msvc)?\.exe$/.test(path.basename(manifest.engine)))) fail('Unexpected executable roles');
    if (mode === 'installer') {
      if (!manifest.installer.endsWith('.exe')) fail('Unexpected installer role');
      for (const key of ['main', 'engine']) if (!/^[a-f0-9]{64}$/.test(manifest.signed_payloads?.[key]?.sha256 ?? '') || !relative(manifest.signed_payloads[key].member)) fail('Missing reviewed signed payload');
    }
  } else if (platform === 'macos') {
    if (manifest.app !== 'Terminus.app' || manifest.dmg !== 'template.dmg') fail('Unexpected macOS layout');
    const appPath = path.join(directory, manifest.app);
    if (!(await lstat(appPath)).isDirectory() || await realpath(appPath) !== appPath) fail('App must be a real directory');
    await regularRole(directory, files, links, manifest.dmg);
    await regularRole(directory, files, links, 'Terminus.app/Contents/Info.plist');
    await regularRole(directory, files, links, 'Terminus.app/Contents/MacOS/terminus');
    if (!manifest.dmg_layout?.files || !manifest.dmg_layout?.links || !Array.isArray(manifest.dmg_layout?.directories)) fail('Missing DMG layout inventory');
    if (manifest.dmg_layout.links.Applications !== '/Applications' || ['.DS_Store', '.VolumeIcon.icns', '.background.tiff'].some(name => !manifest.dmg_layout.files[name])) fail('Missing canonical DMG layout');
    if (!Array.isArray(manifest.architectures) || !manifest.architectures.length || manifest.architectures.some(a => !['arm64', 'x86_64'].includes(a))) fail('Missing reviewed architectures');
  } else {
    await regularRole(directory, files, links, manifest.appimage);
    if (!manifest.appimage.endsWith('.AppImage')) fail('AppImage not inventoried');
  }
  console.log(`Validated ${seen.size} input files/links for ${sourceOid}`);
} else if (command === 'attest') {
  const bytes = await readFile(input);
  if (!/^[a-f0-9]{64}$/.test(process.env.RECEIPT_SHA256 ?? '') || hash(bytes) !== process.env.RECEIPT_SHA256) fail('Externally reviewed build receipt hash mismatch');
  const receipt = JSON.parse(bytes);
  const manifest = JSON.parse(await readFile('candidate/manifest.json', 'utf8'));
  const config = JSON.parse(await readFile(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  if (receipt.source_oid !== sourceOid || receipt.source_oid !== manifest.source_oid || receipt.version !== manifest.version || receipt.platform !== platform || !receipt.qa_evidence) fail('Reviewed build receipt provenance mismatch');
  if (receipt.identifier !== config.identifier || receipt.product_name !== config.productName) fail('Reviewed build receipt identity mismatch');
  const roles = platform === 'linux' ? ['appimage'] : platform === 'macos' ? ['dmg'] : manifest.windows_mode === 'internals' ? ['main', 'engine'] : ['installer'];
  for (const role of roles) if (receipt.artifacts?.[role] !== manifest.files[manifest[role]]) fail('Reviewed build receipt does not bind artifact bytes');
  if (platform === 'macos' && receipt.artifacts?.main !== manifest.files['Terminus.app/Contents/MacOS/terminus']) fail('Reviewed Mac receipt does not bind native main');
  if (platform === 'windows' && manifest.windows_mode === 'installer') {
    for (const role of ['main', 'engine']) if (receipt.signed_payloads?.[role] !== manifest.signed_payloads[role].sha256) fail('Reviewed repack receipt does not bind signed payload');
  }
  await writeFile(path.join(process.env.RUNNER_TEMP, 'reviewed-build-receipt.json'), bytes);
  console.log('Externally pinned build/QA provenance matched');
} else if (command === 'dmg' || command === 'dmg-final') {
  const manifest = JSON.parse(await readFile('candidate/manifest.json', 'utf8'));
  const layout = structuredClone(manifest.dmg_layout);
  const stagedDirectories = ['Terminus.app'];
  async function appDirectories(directory) {
    for (const name of await readdir(directory)) {
      const full = path.join(directory, name);
      if ((await lstat(full)).isDirectory()) {
        stagedDirectories.push(path.relative(path.resolve('candidate'), full).split(path.sep).join('/'));
        await appDirectories(full);
      }
    }
  }
  await appDirectories(path.resolve('candidate/Terminus.app'));
  if (command === 'dmg-final') {
    layout.directories = [...layout.directories.filter(name => name !== 'Terminus.app' && !name.startsWith('Terminus.app/')), ...stagedDirectories];
    for (const entries of [layout.files, layout.links]) for (const name of Object.keys(entries)) if (name.startsWith('Terminus.app/')) delete entries[name];
    async function collect(directory) {
      for (const name of await readdir(directory)) {
        const full = path.join(directory, name);
        const relativeName = path.relative(path.resolve('candidate'), full).split(path.sep).join('/');
        const stat = await lstat(full);
        if (stat.isDirectory()) await collect(full);
        else if (stat.isFile()) layout.files[relativeName] = hash(await readFile(full));
        else if (stat.isSymbolicLink()) layout.links[relativeName] = await readlink(full);
        else fail('Unexpected final app file type');
      }
    }
    await collect(path.resolve('candidate/Terminus.app'));
  }
  await validateInventory(await realpath(input), layout.files, layout.links, true, layout.directories);
  if (command === 'dmg') {
    const reviewedAppDirectories = layout.directories.filter(name => name === 'Terminus.app' || name.startsWith('Terminus.app/'));
    if (reviewedAppDirectories.length !== stagedDirectories.length || reviewedAppDirectories.some(name => !stagedDirectories.includes(name))) fail('DMG app directory mismatch');
    for (const [name, digest] of Object.entries(manifest.files)) {
      if (name.startsWith('Terminus.app/') && manifest.dmg_layout.files[name] !== digest) fail('DMG app does not match reviewed app');
    }
    for (const [name, target] of Object.entries(manifest.links ?? {})) {
      if (name.startsWith('Terminus.app/') && manifest.dmg_layout.links[name] !== target) fail('DMG app link mismatch');
    }
    for (const name of [...Object.keys(manifest.dmg_layout.files), ...Object.keys(manifest.dmg_layout.links)]) {
      if (name.startsWith('Terminus.app/') && !Object.hasOwn(manifest.files, name) && !Object.hasOwn(manifest.links ?? {}, name)) fail('Additional app content inside DMG');
    }
  }
  console.log('DMG layout including all contents and links verified');
} else if (command === 'verify' || command === 'record') {
  const config = JSON.parse(await readFile(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  if (hash(config.plugins.updater.pubkey) !== UPDATER_PUBKEY_SHA256) fail('Installed updater public key changed');
  if (command === 'verify') await verifyFile({filePath: input, sigFileB64: await readFile(input + '.sig', 'utf8'),
    publicKeyB64: config.plugins.updater.pubkey, expectedFileName: path.basename(input)});
  const manifest = JSON.parse(await readFile('candidate/manifest.json', 'utf8'));
  const outputDirectory = command === 'record' ? input : path.dirname(input);
  const outputs = {};
  for (const name of await readdir(outputDirectory)) {
    const full = path.join(outputDirectory, name);
    if ((await lstat(full)).isFile() && name !== 'signing-receipt.json') outputs[name] = hash(await readFile(full));
  }
  const nativeIdentity = JSON.parse(await readFile(path.join(process.env.RUNNER_TEMP, 'native-identity.json'), 'utf8'));
  const receipt = {source_oid: manifest.source_oid, version: manifest.version, platform: manifest.platform,
    signing_workflow_oid: process.env.GITHUB_SHA ?? null, input_release: process.env.INPUT_RELEASE ?? null,
    workflow_definition_oid: process.env.DEFINITION_OID ?? null,
    input_sha256: process.env.INPUT_SHA256 ?? null,
    updater_pubkey_sha256: UPDATER_PUBKEY_SHA256, native_identity: nativeIdentity,
    reviewed_build_receipt_sha256: process.env.RECEIPT_SHA256,
    windows_mode: manifest.windows_mode ?? null, outputs, updater_signature_verified: command === 'verify',
    installed_qa: 'pending', release_published: false};
  await writeFile(path.join(outputDirectory, 'signing-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(command === 'verify' ? 'Updater signature matches installed public key' : 'Compiled binary signing receipt saved');
} else fail('Expected validate or verify');
