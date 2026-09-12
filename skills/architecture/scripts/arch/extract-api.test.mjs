import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractApi } from './extract-api.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'api-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

test('openapi.yaml at root counts 2-space-indent path keys', () => {
  const root = project({ 'openapi.yaml': 'openapi: 3.0.0\npaths:\n  /users:\n    get: {}\n  /users/{id}:\n    get: {}\n' });
  const r = extractApi(root);
  assert.deepEqual(r, { source: 'openapi', file: 'openapi.yaml', pathCount: 2 });
});

test('openapi.json under docs/ counts keys of paths', () => {
  const root = project({ 'docs/openapi.json': JSON.stringify({ paths: { '/a': {}, '/b': {} } }) });
  const r = extractApi(root);
  assert.deepEqual(r, { source: 'openapi', file: 'docs/openapi.json', pathCount: 2 });
});

test('falls back to literal grep, grouped and owned, when no openapi doc exists', () => {
  const root = project({
    'packages/library/src/routes/users.ts': "router.get('/api/users/:id', handler)\nfetch('/api/users')\n",
    'packages/library/src/routes/orders.ts': "fetch(\"/api/orders\")\n",
    'packages/library/tests/users.test.ts': "fetch('/api/users')\n",
  });
  const r = extractApi(root);
  assert.equal(r.source, 'literals');
  assert.deepEqual(r.paths, ['/api/orders', '/api/users', '/api/users/:id']);
  assert.deepEqual(r.groups, [{ group: 'users', count: 2 }, { group: 'orders', count: 1 }]);
  assert.deepEqual(r.byOwner, [{ dir: 'packages/library', count: 2 }]);
});

test('no openapi doc and no production files notes it', () => {
  const root = project({ 'README.md': 'hi\n' });
  const r = extractApi(root);
  assert.equal(r.source, 'literals');
  assert.deepEqual(r.paths, []);
  assert.ok(r.notes.includes('no production .ts/.tsx/.js files found'));
});

test('opts.ignore excludes a directory from the literal-grep scan', () => {
  const root = project({ 'vendor/src/routes.ts': "fetch('/api/users')\n" });
  const r = extractApi(root, { ignore: ['vendor'] });
  assert.deepEqual(r.paths, []);
});
