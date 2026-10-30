import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/candidate-signing.mjs', import.meta.url));
const source = 'a'.repeat(40);
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(change = async () => {}, requestedPlatform = 'windows') {
  const directory = await mkdtemp(join(tmpdir(), 'candidate-signing-'));
  const manifest = {source_oid: source, version: '0.3.0-rc.1', platform: 'windows',
    main: 'terminus.exe', engine: 'seldon-runtime.exe', nsis_script: 'installer.nsi',
    installer: 'setup.exe', makensis_sha256: 'b'.repeat(64), files: {}};
  for (const name of ['terminus.exe', 'seldon-runtime.exe', 'installer.nsi']) {
    await writeFile(join(directory, name), name);
    manifest.files[name] = hash(name);
  }
  try {
    await change(directory, manifest);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    return spawnSync(process.execPath, [script, 'validate', directory, requestedPlatform, source], {encoding: 'utf8'});
  } finally { await rm(directory, {recursive: true, force: true}); }
}
test('accepts an exhaustive input inventory tied to source OID', async () => {
  const result = await fixture();
  assert.equal(result.status, 0, result.stderr);
});
for (const [name, change, message] of [
  ['changed bytes', async d => writeFile(join(d, 'terminus.exe'), 'changed'), /Hash mismatch/],
  ['wrong OID', async (_d, m) => { m.source_oid = 'c'.repeat(40); }, /Provenance mismatch/],
  ['unlisted file', async d => writeFile(join(d, 'extra.exe'), 'extra'), /Hash mismatch/],
  ['missing resource', async d => rm(join(d, 'installer.nsi')), /Missing input/],
  ['parent path', async (_d, m) => { m.files['../outside'] = 'd'.repeat(64); }, /Invalid inventory path/],
  ['Windows alternate stream', async (_d, m) => { m.files['file:stream'] = 'd'.repeat(64); }, /Invalid inventory path/],
  ['preexisting installer', async (d, m) => { await writeFile(join(d, 'setup.exe'), 'setup'); m.files['setup.exe'] = hash('setup'); }, /must not exist/],
  ['toolchain not pinned', async (_d, m) => { delete m.makensis_sha256; }, /toolchain hash/],
]) test(`rejects ${name}`, async () => {
  const result = await fixture(change);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
});
test('rejects a symlink outside the input tree', {skip: process.platform === 'win32'}, async () => {
  const result = await fixture(async (d, m) => {
    await symlink(tmpdir(), join(d, 'external'));
    m.links = {external: tmpdir()};
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /External symlink/);
});
test('accepts the existing Linux artifact without repackaging', async () => {
  const result = await fixture(async (d, m) => {
    m.platform = 'linux';
    m.appimage = 'Terminus.AppImage';
    await writeFile(join(d, m.appimage), 'existing-appimage');
    m.files[m.appimage] = hash('existing-appimage');
  }, 'linux');
  assert.equal(result.status, 0, result.stderr);
});
test('rejects a Linux artifact absent from the inventory', async () => {
  const result = await fixture(async (_d, m) => {
    m.platform = 'linux';
    m.appimage = 'missing.AppImage';
  }, 'linux');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AppImage not inventoried/);
});
