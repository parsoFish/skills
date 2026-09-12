import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractDeps } from './extract-deps.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'deps-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

test('root deps: used dep gets import sites, unused dep flagged', () => {
  const root = project({
    'package.json': JSON.stringify({ name: 'app', dependencies: { zod: '^3.0.0', leftpad: '^1.0.0' } }),
    'src/index.ts': "import { z } from 'zod'\n",
    'package-lock.json': '{}',
  });
  const r = extractDeps(root);
  assert.deepEqual(r.deps.map(d => d.name), ['leftpad', 'zod']);
  const zod = r.deps.find(d => d.name === 'zod');
  assert.equal(zod.unused, false);
  assert.deepEqual(zod.importSites, ['src/index.ts']);
  assert.equal(zod.why, 'imported by src/index.ts');
  assert.deepEqual(zod.usedBy, ['app']);
  const leftpad = r.deps.find(d => d.name === 'leftpad');
  assert.equal(leftpad.unused, true);
  assert.equal(leftpad.why, null);
  assert.equal(r.lockfile, 'package-lock.json');
});

test('workspaces glob resolves member packages and unions usedBy', () => {
  const root = project({
    'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*'], dependencies: { shared: '^1.0.0' } }),
    'packages/flows/package.json': JSON.stringify({ name: '@x/flows', dependencies: { shared: '^1.0.0' } }),
    'packages/flows/src/a.ts': "require('shared')\n",
  });
  const r = extractDeps(root);
  const shared = r.deps.find(d => d.name === 'shared');
  assert.deepEqual(shared.usedBy, ['@x/flows', 'root']);
  assert.deepEqual(shared.importSites, ['packages/flows/src/a.ts']);
});

test('go.mod require block is parsed and attributed to the module name', () => {
  const root = project({ 'go.mod': 'module github.com/x/y\n\nrequire (\n\tgithub.com/pkg/errors v0.9.1\n)\n' });
  const r = extractDeps(root);
  assert.deepEqual(r.deps, [{ name: 'github.com/pkg/errors', version: 'v0.9.1', usedBy: ['github.com/x/y'], importSites: [], why: null, unused: true }]);
});

test('terraform required_providers parsed with version constraint', () => {
  const root = project({ 'infra/main.tf': 'terraform {\n  required_providers {\n    aws = {\n      source  = "hashicorp/aws"\n      version = "~> 5.0"\n    }\n  }\n}\n' });
  const r = extractDeps(root);
  assert.equal(r.deps.length, 1);
  assert.equal(r.deps[0].name, 'aws');
  assert.equal(r.deps[0].version, '~> 5.0');
});

test('missing package.json is noted, not thrown', () => {
  const root = project({ 'README.md': 'hi\n' });
  const r = extractDeps(root);
  assert.deepEqual(r.deps, []);
  assert.equal(r.lockfile, null);
  assert.ok(r.notes.includes('no root package.json'));
});

test('import sites and test files/node_modules are excluded from grep', () => {
  const root = project({
    'package.json': JSON.stringify({ dependencies: { zod: '^3.0.0' } }),
    'src/a.test.ts': "import { z } from 'zod'\n",
    'node_modules/zod/index.js': "import { z } from 'zod'\n",
  });
  const r = extractDeps(root);
  assert.equal(r.deps[0].unused, true);
});

test('opts.ignore excludes a directory from the import-site scan', () => {
  const root = project({
    'package.json': JSON.stringify({ dependencies: { zod: '^3.0.0' } }),
    'vendor/src/index.ts': "import { z } from 'zod'\n",
  });
  const r = extractDeps(root, { ignore: ['vendor'] });
  assert.equal(r.deps[0].unused, true);
  assert.deepEqual(r.deps[0].importSites, []);
});

test('up to 8 import sites are collected; why names the first and counts the rest', () => {
  const files = { 'package.json': JSON.stringify({ dependencies: { zod: '^3.0.0' } }) };
  for (let i = 0; i < 9; i++) files[`src/f${i}.ts`] = "import { z } from 'zod'\n";
  const root = project(files);
  const r = extractDeps(root);
  const zod = r.deps[0];
  assert.equal(zod.importSites.length, 8);
  assert.equal(zod.why, `imported by ${zod.importSites[0]} (+7 more)`);
});
