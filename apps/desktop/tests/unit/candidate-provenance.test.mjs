import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/candidate-signing.mjs', import.meta.url));
const source = 'a'.repeat(40);
const hash = value => createHash('sha256').update(value).digest('hex');
async function attest(change = () => {}, wrongHash = false) {
  const directory = await mkdtemp(join(tmpdir(), 'candidate-provenance-'));
  try {
    await mkdir(join(directory, 'candidate'));
    const manifest = {source_oid: source, version: '0.3.0-rc.1', platform: 'linux', appimage: 'app.AppImage', files: {'app.AppImage': hash('existing')}};
    await writeFile(join(directory, 'candidate/manifest.json'), JSON.stringify(manifest));
    const receipt = {source_oid: source, version: manifest.version, identifier: 'ai.danil.terminus', product_name: 'Terminus', platform: 'linux', qa_evidence: 'reviewed-fixture', artifacts: {appimage: hash('existing')}};
    change(receipt);
    const bytes = JSON.stringify(receipt);
    await writeFile(join(directory, 'receipt.json'), bytes);
    return spawnSync(process.execPath, [script, 'attest', 'receipt.json', 'linux', source], {cwd: directory, encoding: 'utf8',
      env: {...process.env, RUNNER_TEMP: directory, RECEIPT_SHA256: wrongHash ? '0'.repeat(64) : hash(bytes)}});
  } finally { await rm(directory, {recursive: true, force: true}); }
}
test('accepts provenance only with externally pinned receipt bytes', async () => {
  const result = await attest();
  assert.equal(result.status, 0, result.stderr);
});
test('rejects an unapproved receipt even when its JSON fields match', async () => assert.notEqual((await attest(() => {}, true)).status, 0));
for (const [name, change] of [
  ['source', r => { r.source_oid = 'b'.repeat(40); }],
  ['version', r => { r.version = '0.2.88'; }],
  ['identity', r => { r.identifier = 'other.app'; }],
  ['product', r => { r.product_name = 'Other'; }],
  ['artifact bytes', r => { r.artifacts.appimage = 'c'.repeat(64); }],
  ['QA evidence', r => { delete r.qa_evidence; }],
]) test(`rejects reviewed receipt with mismatched ${name}`, async () => assert.notEqual((await attest(change)).status, 0));

async function dmg(change = async () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'candidate-dmg-'));
  try {
    const mounted = join(directory, 'mounted');
    await mkdir(join(directory, 'candidate'));
    await mkdir(join(directory, 'candidate/Terminus.app'));
    await writeFile(join(directory, 'candidate/Terminus.app/main'), 'main');
    await mkdir(join(mounted, 'Terminus.app'), {recursive: true});
    await writeFile(join(mounted, 'Terminus.app/main'), 'main');
    await writeFile(join(mounted, '.DS_Store'), 'layout');
    await symlink('/Applications', join(mounted, 'Applications'));
    const manifest = {files: {'Terminus.app/main': hash('main')}, links: {}, dmg_layout: {
      files: {'Terminus.app/main': hash('main'), '.DS_Store': hash('layout')}, links: {Applications: '/Applications'}, directories: ['Terminus.app']}};
    await change(mounted, manifest);
    await writeFile(join(directory, 'candidate/manifest.json'), JSON.stringify(manifest));
    return spawnSync(process.execPath, [script, 'dmg', mounted], {cwd: directory, encoding: 'utf8'});
  } finally { await rm(directory, {recursive: true, force: true}); }
}
test('accepts the inventoried DMG contents and canonical Applications link', {skip: process.platform === 'win32'}, async () => {
  const result = await dmg();
  assert.equal(result.status, 0, result.stderr);
});
test('rejects extra executable content in the DMG', {skip: process.platform === 'win32'}, async () => {
  const result = await dmg(async d => writeFile(join(d, 'extra.command'), 'unreviewed'));
  assert.notEqual(result.status, 0);
});
test('rejects an uninventoried empty DMG directory', {skip: process.platform === 'win32'}, async () => {
  const result = await dmg(async d => mkdir(join(d, 'extra')));
  assert.notEqual(result.status, 0);
});
test('rejects extra DMG app content even if listed only in DMG inventory', {skip: process.platform === 'win32'}, async () => {
  const result = await dmg(async (d, m) => {
    await writeFile(join(d, 'Terminus.app/extra'), 'extra');
    m.dmg_layout.files['Terminus.app/extra'] = hash('extra');
  });
  assert.notEqual(result.status, 0);
});
test('rejects another external DMG symlink', {skip: process.platform === 'win32'}, async () => {
  const result = await dmg(async (d, m) => {
    await symlink('/tmp', join(d, 'other'));
    m.dmg_layout.links.other = '/tmp';
  });
  assert.notEqual(result.status, 0);
});
