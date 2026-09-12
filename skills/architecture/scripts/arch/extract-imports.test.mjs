import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractImports, specifiers } from './extract-imports.mjs';
import { fold } from './fold.mjs';

function proj() {
  const root = mkdtempSync(join(tmpdir(), 'imp-'));
  const w = (p, c) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); };
  w('src/cli/main.ts', "import { run } from '../core/run.js';\nimport express from 'express';\nimport { x } from '../web';\nconst y = require('../core/util');\n");
  w('src/core/run.ts', 'export const run = () => 1;');
  w('src/core/util.ts', 'export const u = 1;');
  w('src/web/index.tsx', "import { run } from '../core/run';\nexport const x = run;");
  w('src/web/server.test.ts', "import { x } from './index';");
  w('node_modules/express/index.js', 'module.exports = {};');
  return root;
}

test('specifiers finds import, export-from, dynamic import and require', () => {
  assert.deepEqual(specifiers("import a from './a'; export { b } from './b'; const c = require('./c'); await import('./d'); import './side';"), ['./a', './b', './c', './d', './side']);
});

test('extractImports resolves relative imports with .js→.ts and index conventions; bare specifiers stay unresolved', () => {
  const root = proj();
  const dc = extractImports(root);
  const main = dc.modules.find(m => m.source === 'src/cli/main.ts');
  assert.deepEqual(main.dependencies.map(d => [d.module, d.resolved]), [['../core/run.js', 'src/core/run.ts'], ['../core/util', 'src/core/util.ts'], ['../web', 'src/web/index.tsx'], ['express', null]]);
  assert.equal(dc.summary.engine, 'builtin-imports');
  assert.ok(!dc.modules.some(m => m.source.startsWith('node_modules')));
});

test('output feeds fold.mjs and is deterministic', () => {
  const root = proj();
  const rules = [{ match: '^src/([^/]+)/', component: '$1' }];
  const g = fold(extractImports(root), rules);
  assert.deepEqual(g.nodes.map(n => n.id), ['cli', 'core', 'web']);
  assert.deepEqual(g.edges, [{ from: 'cli', to: 'core', count: 2 }, { from: 'cli', to: 'web', count: 1 }, { from: 'web', to: 'core', count: 1 }]);
  assert.equal(JSON.stringify(extractImports(root)), JSON.stringify(extractImports(root)));
});
