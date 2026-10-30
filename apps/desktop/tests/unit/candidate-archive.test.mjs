import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/candidate-archive.py', import.meta.url));
const python = process.platform === 'win32' ? 'python' : 'python3';
const builder = `import sys,json,zipfile,stat
with zipfile.ZipFile(sys.argv[1],'w') as archive:
 for item in json.load(sys.stdin):
  entry=zipfile.ZipInfo(item[0]); entry.create_system=3
  entry.external_attr=(stat.S_IFLNK|0o777)<<16 if len(item)>2 and item[2]=='link' else (stat.S_IFREG|0o644)<<16
  archive.writestr(entry,item[1])
`;
async function fixture(entries, platform = 'macos', badHash = false) {
  const directory = await mkdtemp(join(tmpdir(), 'candidate-archive-'));
  try {
    const archive = join(directory, 'input.zip');
    const build = spawnSync(python, ['-c', builder, archive], {input: JSON.stringify(entries), encoding: 'utf8'});
    assert.equal(build.status, 0, build.stderr);
    const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
    const destination = join(directory, 'out');
    const result = spawnSync(python, [script, archive, destination, badHash ? '0'.repeat(64) : digest, platform], {encoding: 'utf8'});
    const created = (await readdir(directory)).includes('out');
    if (result.status !== 0) assert.equal(created, false, 'Rejected archive must create no extraction tree');
    else if (entries.some(e => e[2] === 'link')) assert.equal((await lstat(join(destination, 'alias'))).isSymbolicLink(), true);
    return result;
  } finally { await rm(directory, {recursive: true, force: true}); }
}
test('extracts regular entries after inspection', async () => assert.equal((await fixture([['file','content']])).status, 0));
test('preserves a checked internal symlink without following it', {skip: process.platform === 'win32'}, async () => assert.equal((await fixture([['file','content'],['alias','file','link']])).status, 0));
for (const [name, entries, platform = 'macos'] of [
  ['traversal', [['../escape','bad']]],
  ['absolute path', [['/tmp/escape','bad']]],
  ['Windows drive', [['C:/escape','bad']]],
  ['backslash', [['a\\b','bad']]],
  ['duplicate', [['file','a'],['file','b']]],
  ['case alias', [['File','a'],['file','b']]],
  ['Unicode alias', [['é','a'],['é','b']]],
  ['case alias ancestor', [['Dir/a','a'],['dir/b','b']]],
  ['file parent', [['file','a'],['file/child','b']]],
  ['external symlink', [['alias','/tmp','link']]],
  ['escaping symlink', [['alias','../outside','link']]],
  ['symlink ancestor', [['file','a'],['alias','file','link'],['alias/child','b']]],
  ['symlink cycle', [['alias','alias','link']]],
  ['Windows symlink', [['file','a'],['alias','file','link']], 'windows'],
]) test(`rejects ZIP ${name} before extraction`, async () => assert.notEqual((await fixture(entries, platform)).status, 0));
test('rejects an externally mismatched archive hash before extraction', async () => assert.notEqual((await fixture([['file','content']], 'linux', true)).status, 0));
