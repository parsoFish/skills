import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractTests } from './extract-tests.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'tests-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

test('finds *.test.* and *.spec.* and /tests?/ and /__tests__/, counts per top-level dir', () => {
  const root = project({
    'packages/flows/tests/a.test.ts': '',
    'packages/flows/b.spec.ts': '',
    'packages/agents/__tests__/c.ts': '',
    'src/not-a-test.ts': '',
    'node_modules/pkg/x.test.ts': '',
  });
  const r = extractTests(root);
  assert.equal(r.total, 3);
  assert.deepEqual(r.byDir, [{ dir: 'packages/flows', count: 2 }, { dir: 'packages/agents', count: 1 }]);
  assert.equal(r.taggingAdopted, false);
});

test('@seam and @layer tags on the same line are counted per seam/layer', () => {
  const root = project({
    'tests/a.test.ts': "// @seam auth @layer unit\ntest('x', () => {})\n// @seam auth @layer unit\ntest('y', () => {})\n",
    'tests/b.test.ts': "// @seam auth @layer contract\ntest('z', () => {})\n// @seam billing @layer journey\ntest('w', () => {})\n",
  });
  const r = extractTests(root);
  assert.equal(r.taggingAdopted, true);
  assert.deepEqual(r.tagged.seams, [
    { seam: 'auth', layers: { unit: 2, contract: 1, journey: 0, ground: 0 } },
    { seam: 'billing', layers: { unit: 0, contract: 0, journey: 1, ground: 0 } },
  ]);
  assert.equal(r.tagged.count, 2);
});

test('a @seam tag without a @layer on the same line still registers the seam with zero counts', () => {
  const root = project({ 'tests/a.test.ts': '// @seam auth\n' });
  const r = extractTests(root);
  assert.deepEqual(r.tagged.seams, [{ seam: 'auth', layers: { unit: 0, contract: 0, journey: 0, ground: 0 } }]);
});

test('no test files gives total 0 without throwing', () => {
  const root = project({ 'README.md': 'hi\n' });
  const r = extractTests(root);
  assert.deepEqual(r, { total: 0, byDir: [], tagged: { seams: [], count: 0 }, taggingAdopted: false });
});

test('opts.ignore excludes a directory from the test-file scan', () => {
  const root = project({ 'archive/tests/old.test.ts': '', 'packages/flows/tests/a.test.ts': '' });
  const r = extractTests(root, { ignore: ['archive'] });
  assert.equal(r.total, 1);
  assert.deepEqual(r.byDir, [{ dir: 'packages/flows', count: 1 }]);
});
