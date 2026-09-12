import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveBase, changedScope, changedSkills, changedPaths, shStrict, createGit, EMPTY_TREE_SHA } from '../scripts/gate/scope.mjs';

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'gate-scope-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'a'], { cwd: root });
  return root;
}

function commitAll(root, message) {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: root });
}

test('resolveBase falls through a missing --base to @{upstream}, then origin/main, then main, then the empty-tree sentinel', () => {
  const calls = [];
  const verify = candidate => { calls.push(candidate); return candidate === 'origin/main'; };
  assert.equal(resolveBase('feature/x', { verify }), 'origin/main');
  assert.deepEqual(calls, ['feature/x', '@{upstream}', 'origin/main']);

  assert.equal(resolveBase(undefined, { verify: () => false }), EMPTY_TREE_SHA, 'no ref resolves — fall back to the empty tree so everything counts as changed');
});

test('resolveBase tolerates a missing upstream: it is just another candidate that can fail to resolve', () => {
  const seen = new Set();
  const verify = ref => { seen.add(ref); return ref === 'main'; };
  assert.equal(resolveBase(undefined, { verify }), 'main');
  assert.ok(seen.has('@{upstream}'), 'still tried @{upstream} before falling through');
});

test('shStrict throws (naming the command and stderr) on a non-zero git exit instead of swallowing it', () => {
  const root = tempRepo();
  assert.throws(() => shStrict(['rev-parse', '--verify', 'not-a-real-ref'], { cwd: root }), /git rev-parse --verify not-a-real-ref exited/);
});

test('shStrict returns stdout on success', () => {
  const root = tempRepo();
  writeFileSync(join(root, 'a.txt'), 'x');
  commitAll(root, 'init');
  const out = shStrict(['rev-parse', 'HEAD'], { cwd: root });
  assert.match(out.trim(), /^[0-9a-f]{40}$/);
});

test('createGit(root).verify reflects git rev-parse --verify without throwing on a bad ref', () => {
  const root = tempRepo();
  writeFileSync(join(root, 'a.txt'), 'x');
  commitAll(root, 'init');
  const git = createGit(root);
  assert.equal(git.verify('HEAD'), true);
  assert.equal(git.verify('nope-not-a-ref'), false);
});

test('changedScope flags harness=true for gate/CI plumbing paths and false otherwise', () => {
  assert.deepEqual(changedScope(['skills/a/SKILL.md']), { skills: ['a'], harness: false });
  assert.deepEqual(changedScope(['scripts/gate.mjs']).harness, true);
  assert.deepEqual(changedScope(['tests/gate.test.mjs']).harness, true);
  assert.deepEqual(changedScope(['lint.config.json']).harness, true);
  assert.deepEqual(changedScope(['gate.config.json']).harness, true);
  assert.deepEqual(changedScope(['package.json']).harness, true);
  assert.deepEqual(changedScope(['.github/workflows/ci.yml']).harness, true);
  assert.deepEqual(changedScope(['README.md']).harness, false);
  assert.deepEqual(changedScope([]), { skills: [], harness: false });
});

test('changedScope carries the skill list alongside the harness flag when both changed', () => {
  assert.deepEqual(changedScope(['skills/b/SKILL.md', 'scripts/gate.mjs']), { skills: ['b'], harness: true });
});

test('changedSkills maps skill and eval paths to skill names, deduplicated and sorted', () => {
  assert.deepEqual(changedSkills(['skills/b/SKILL.md', 'evals/a/case/prompt.md', 'skills/b/scripts/x.mjs', 'README.md', 'scripts/gate.mjs']), ['a', 'b']);
  assert.deepEqual(changedSkills([]), []);
});

test('changedPaths reports committed diff, uncommitted diff and untracked files against a resolved base', () => {
  const root = tempRepo();
  writeFileSync(join(root, 'skills-marker.txt'), 'base');
  commitAll(root, 'base commit');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  mkdirSync(join(root, 'skills', 'x'), { recursive: true });
  writeFileSync(join(root, 'skills', 'x', 'SKILL.md'), 'committed change');
  commitAll(root, 'add skill');

  writeFileSync(join(root, 'skills-marker.txt'), 'uncommitted edit');
  writeFileSync(join(root, 'untracked.txt'), 'new');

  const paths = changedPaths(root, base);
  assert.ok(paths.includes('skills/x/SKILL.md'), 'committed diff');
  assert.ok(paths.includes('skills-marker.txt'), 'uncommitted diff against HEAD');
  assert.ok(paths.includes('untracked.txt'), 'untracked file');
});

test('changedPaths against the empty-tree sentinel treats every tracked path as changed (two-dot diff, not merge-base three-dot)', () => {
  const root = tempRepo();
  writeFileSync(join(root, 'a.txt'), 'x');
  commitAll(root, 'init');
  const paths = changedPaths(root, EMPTY_TREE_SHA);
  assert.ok(paths.includes('a.txt'));
});
