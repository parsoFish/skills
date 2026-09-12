import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractEnv } from './extract-env.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'env-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

test('process.env.NAME in JS/TS is counted with file:line sites, sorted by count desc', () => {
  const root = project({
    'src/a.ts': 'const a = process.env.API_TOKEN\nconst b = process.env.PORT\n',
    'src/b.ts': 'const c = process.env.PORT\n',
  });
  const r = extractEnv(root);
  assert.deepEqual(r.vars, [
    { name: 'PORT', count: 2, sites: ['src/a.ts:2', 'src/b.ts:1'] },
    { name: 'API_TOKEN', count: 1, sites: ['src/a.ts:1'] },
  ]);
  assert.deepEqual(r.secretLike, ['API_TOKEN']);
});

test('Go os.Getenv and Python os.environ patterns are recognized', () => {
  const root = project({
    'main.go': 'v := os.Getenv("DB_PASSWORD")\n',
    'app.py': "v = os.environ['DB_PASSWORD']\nw = os.environ.get(\"AWS_SECRET_KEY\")\n",
  });
  const r = extractEnv(root);
  const byName = Object.fromEntries(r.vars.map(v => [v.name, v]));
  assert.equal(byName.DB_PASSWORD.count, 2);
  assert.ok(byName.AWS_SECRET_KEY);
  assert.deepEqual(r.secretLike, ['AWS_SECRET_KEY', 'DB_PASSWORD']);
});

test('env.NAME generic pattern is recognized but not confused with a preceding dot', () => {
  const root = project({ 'src/a.ts': 'const x = env.FEATURE_FLAG\nconst y = foo.env.OTHER\n' });
  const r = extractEnv(root);
  assert.deepEqual(r.vars.map(v => v.name).sort(), ['FEATURE_FLAG']);
});

test('test files and node_modules are excluded', () => {
  const root = project({ 'src/a.test.ts': 'process.env.SECRET_X\n', 'node_modules/pkg/x.ts': 'process.env.SECRET_X\n' });
  const r = extractEnv(root);
  assert.deepEqual(r.vars, []);
});

test('empty project yields empty result without throwing', () => {
  const root = project({ 'README.md': 'hi\n' });
  const r = extractEnv(root);
  assert.deepEqual(r, { vars: [], secretLike: [] });
});
