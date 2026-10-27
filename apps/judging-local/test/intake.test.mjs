import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { intakeTeam } from '../server/intake.mjs';
import { openStore } from '../server/store.mjs';

const exec = promisify(execFile);
async function git(directory, ...args) {
  return (await exec('git', ['-c', 'core.hooksPath=NUL', ...args], { cwd: directory, windowsHide: true })).stdout.trim();
}

test('intake resumes verified snapshots, preserves interrupted folders and records changed HEAD separately', async () => {
  const temporaryRoot = resolve(tmpdir());
  const root = await mkdtemp(resolve(temporaryRoot, 'sdc-intake-test-'));
  const store = openStore(':memory:');
  try {
    const repository = resolve(root, 'participant-fixture');
    const workspace = resolve(root, 'workspace');
    await mkdir(repository);
    await mkdir(workspace);
    await git(repository, 'init', '-b', 'main');
    await git(repository, 'config', 'user.name', 'Fixture');
    await git(repository, 'config', 'user.email', 'fixture@example.invalid');
    await writeFile(resolve(repository, 'README.md'), '# Proposal\nFixture evidence only.\n');
    await git(repository, 'add', 'README.md');
    await git(repository, 'commit', '-m', 'Initial fixture');
    const firstSha = await git(repository, 'rev-parse', 'HEAD');
    const interrupted = resolve(workspace, 'repos/01-console', firstSha);
    await mkdir(interrupted, { recursive: true });
    await writeFile(resolve(interrupted, 'partial.txt'), 'preserve this interrupted clone');
    const team = { id: '01-console', repoUrl: repository };
    const first = await intakeTeam({ workspace, team, store });
    assert.equal(first.sha, firstSha);
    assert.match(first.snapshotPath, /-retry-/);
    assert.equal(await readFile(resolve(interrupted, 'partial.txt'), 'utf8'), 'preserve this interrupted clone');
    const savedVersion = store.get('intake:01-console').version;
    assert.deepEqual(await intakeTeam({ workspace, team, store }), first);
    assert.deepEqual(await intakeTeam({ workspace, team, store, refresh: true }), first);
    assert.equal(store.get('intake:01-console').version, savedVersion);
    await writeFile(resolve(repository, 'README.md'), '# Proposal\nChanged remote evidence.\n');
    await git(repository, 'add', 'README.md');
    await git(repository, 'commit', '-m', 'Changed fixture');
    const second = await intakeTeam({ workspace, team, store, refresh: true });
    assert.notEqual(second.sha, first.sha);
    assert.deepEqual(second.previousSnapshots.map(item => item.sha), [first.sha]);
    assert.equal(await git(resolve(workspace, first.snapshotPath), 'rev-parse', 'HEAD'), first.sha);
    assert.match(await readFile(resolve(workspace, first.snapshotPath, 'README.md'), 'utf8'), /Fixture evidence only/);
    await writeFile(resolve(workspace, second.snapshotPath, 'README.md'), 'tampered');
    await assert.rejects(intakeTeam({ workspace, team, store }), /working-tree changes/);
    assert.equal(await readFile(resolve(workspace, second.snapshotPath, 'README.md'), 'utf8'), 'tampered');
  } finally {
    store.close();
    assert.ok(root.startsWith(temporaryRoot + sep) && root.includes('sdc-intake-test-'));
    await rm(root, { recursive: true, force: true });
  }
});
