import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = JSON.parse(execFileSync('ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_file(ARGV[0]))', '.github/workflows/publicar.yml'], { cwd: repo, encoding: 'utf8' }));
const { verifyFile } = await import(pathToFileURL(join(repo, 'npx/lib/minisign.mjs')));
const scratch = mkdtempSync(join(tmpdir(), 'terminus-intel-test-'));
const pnpm = execFileSync('which', ['pnpm'], { encoding: 'utf8' }).trim();
const cli = ['--package=@tauri-apps/cli@2.11.4', 'dlx', 'tauri'];
const step = (job, name) => workflow.jobs[job].steps.find(s => s.name === name).run;
const run = (code, cwd, env, expected = 0) => {
  const r = spawnSync('bash', ['-c', code], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, expected, `${r.error || ''}\n${r.stdout}\n${r.stderr}`);
  return r;
};
try {
  execFileSync(pnpm, [...cli, 'signer', 'generate', '--ci', '-p', '', '-w', join(scratch, 'test.key')], { encoding: 'utf8', stdio: 'pipe' });
  const publicKeyB64 = readFileSync(join(scratch, 'test.key.pub'), 'utf8').trim();
  const signing = { TAURI_SIGNING_PRIVATE_KEY: readFileSync(join(scratch, 'test.key'), 'utf8').trim(), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' };
  const bin = join(scratch, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), `#!/bin/sh\nshift\nexec '${pnpm.replaceAll("'", "'\\''")}' --package=@tauri-apps/cli@2.11.4 dlx tauri "$@"\n`, { mode: 0o755 });
  const merged = join(scratch, 'merged');
  mkdirSync(join(merged, 'entrega'), { recursive: true });
  const matrices = workflow.jobs.construir.strategy.matrix.include;
  assert.deepEqual(matrices.map(m => m.nombre), ['windows', 'macos', 'macos-intel']);
  const intel = matrices.find(m => m.nombre === 'macos-intel');
  assert.equal(intel.so, 'macos-15-intel');
  assert.equal(intel.mach_arch, 'x86_64');
  for (const row of matrices) {
    const cwd = join(scratch, row.nombre);
    const bundle = join(cwd, 'src-tauri/target/release/bundle');
    const resources = join(cwd, 'src-tauri/resources');
    mkdirSync(bundle, { recursive: true });
    mkdirSync(resources, { recursive: true });
    writeFileSync(join(resources, 'git-version.txt'), 'test git\n');
    const archive = row.nombre === 'windows' ? 'Terminus_9.9.9_x64-setup.exe' : 'Terminus.app.tar.gz';
    writeFileSync(join(bundle, archive), `Fixture for ${row.nombre}`);
    execFileSync(pnpm, [...cli, 'signer', 'sign', join(bundle, archive)], { env: { ...process.env, ...signing }, stdio: 'pipe' });
    if (row.arch) writeFileSync(join(bundle, `Terminus_9.9.9_${row.arch === 'x86_64' ? 'x64' : row.arch}.dmg`), row.nombre);
    const code = step('construir', 'Recoger los artefactos').replaceAll('${{ matrix.nombre }}', row.nombre);
    const env = { ...signing, PATH: `${bin}:${process.env.PATH}`, V: '9.9.9', MAC_ARCH: row.arch || '', GITHUB_STEP_SUMMARY: join(cwd, 'summary') };
    run(code, cwd, env);
    const files = readdirSync(join(cwd, 'entrega'));
    if (row.nombre === 'macos-intel') {
      assert.deepEqual(files.sort(), ['Terminus-Intel.app.tar.gz', 'Terminus-Intel.app.tar.gz.sig', 'Terminus-macOS-Intel.dmg', 'Terminus_9.9.9_x64.dmg'].sort());
      await assert.rejects(verifyFile({ filePath: join(cwd, 'entrega/Terminus-Intel.app.tar.gz'), sigFileB64: readFileSync(join(bundle, `${archive}.sig`), 'utf8'), publicKeyB64, expectedFileName: 'Terminus-Intel.app.tar.gz' }), /la firma es para/);
      rmSync(join(bundle, 'Terminus_9.9.9_x64.dmg'));
      run(code, cwd, env, 1);
    }
    for (const f of files) {
      assert(!readdirSync(join(merged, 'entrega')).includes(f), `Asset collision: ${f}`);
      cpSync(join(cwd, 'entrega', f), join(merged, 'entrega', f));
    }
  }
  const env = { V: '9.9.9', NOTA: 'Intel test', GITHUB_REPOSITORY: 'danil-labs/terminus' };
  run(step('publicar', 'Cada firma habla del archivo que se publica'), merged, env);
  run(step('publicar', 'Armar latest.json'), merged, env);
  const manifest = JSON.parse(readFileSync(join(merged, 'entrega/latest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64'].sort());
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    const name = basename(new URL(entry.url).pathname);
    await verifyFile({ filePath: join(merged, 'entrega', name), sigFileB64: entry.signature, publicKeyB64, expectedFileName: name });
    console.log(`PASS ${platform}: distinct asset, valid Tauri signature, accepted by npx`);
  }
  const platformSource = readFileSync(join(repo, 'npx/lib/platform.mjs'), 'utf8');
  for (const [arch, expected] of [['x64', 'darwin-x86_64'], ['arm64', 'darwin-aarch64']]) {
    const { detectPlatform } = await import(`data:text/javascript,${encodeURIComponent(platformSource.replace('process.platform', "'darwin'").replace('process.arch;', `'${arch}';`))}`);
    assert.equal(detectPlatform().key, expected);
  }
  console.log('PASS negative controls: stale filename signature rejected; missing Intel DMG aborts collection');
  console.log('PASS npx architecture selection: Mac Intel and Apple Silicon');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
