import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkFiles, isTestPath, DEFAULT_IGNORE } from './walk.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'walk-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

test('default ignore names (e.g. node_modules) are skipped at any depth', () => {
  const root = project({
    'src/a.ts': '',
    'node_modules/pkg/index.js': '',
    'packages/lib/node_modules/nested/index.js': '',
  });
  assert.deepEqual(walkFiles(root), ['src/a.ts']);
});

test('custom ignore entries match the full relative path, not a bare name anywhere', () => {
  const root = project({
    'projects/a.ts': '',
    'apps/projects/b.ts': '',
    '_wave7/c.ts': '',
  });
  const r = walkFiles(root, { ignore: ['projects', '_wave7'] });
  assert.deepEqual(r, ['apps/projects/b.ts']);
});

test('exts filters to the given extensions', () => {
  const root = project({ 'src/a.ts': '', 'src/b.md': '', 'src/c.tsx': '' });
  assert.deepEqual(walkFiles(root, { exts: ['.ts'] }), ['src/a.ts']);
  assert.deepEqual(walkFiles(root, { exts: ['.ts', '.tsx'] }), ['src/a.ts', 'src/c.tsx']);
});

test('cap throws naming the cap instead of silently truncating', () => {
  const root = project({ 'a.ts': '', 'b.ts': '', 'c.ts': '' });
  assert.throws(() => walkFiles(root, { cap: 2 }), /cap of 2/);
});

test('output is sorted', () => {
  const root = project({ 'z.ts': '', 'a.ts': '', 'm/n.ts': '' });
  assert.deepEqual(walkFiles(root), ['a.ts', 'm/n.ts', 'z.ts']);
});

test('DEFAULT_IGNORE covers the common build/vendor/cache directories', () => {
  for (const name of ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo', '.cache', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv']) {
    assert.ok(DEFAULT_IGNORE.includes(name), `expected DEFAULT_IGNORE to include ${name}`);
  }
});

test('isTestPath matches test dirs, fixtures/stories dirs, and .test./.spec. files', () => {
  assert.ok(isTestPath('src/tests/a.ts'));
  assert.ok(isTestPath('src/__tests__/a.ts'));
  assert.ok(isTestPath('src/test-fixtures/a.ts'));
  assert.ok(isTestPath('src/fixtures/a.ts'));
  assert.ok(isTestPath('src/stories/a.ts'));
  assert.ok(isTestPath('src/a.test.ts'));
  assert.ok(isTestPath('src/a.spec.tsx'));
  assert.ok(isTestPath('src/a.test.mjs'));
  assert.ok(!isTestPath('src/a.ts'));
  assert.ok(!isTestPath('src/testing-utils.ts'));
});
