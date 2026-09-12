import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractExtPoints, globMatch } from './extract-ext-points.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'extpts-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

test('globMatch: "*" is one segment, "**" is any depth', () => {
  assert.equal(globMatch('skills/*/SKILL.md', 'skills/foo/SKILL.md'), true);
  assert.equal(globMatch('skills/*/SKILL.md', 'skills/foo/bar/SKILL.md'), false);
  assert.equal(globMatch('**/adapters/*', 'src/lib/adapters/http.ts'), true);
  assert.equal(globMatch('**/adapters/*', 'adapters/http.ts'), true);
  assert.equal(globMatch('.claude/commands/*.md', '.claude/commands/deploy.md'), true);
  assert.equal(globMatch('.claude/commands/*.md', '.claude/commands/x/deploy.md'), false);
});

test('default registries discover skills, commands, plugins, adapters', () => {
  const root = project({
    'skills/architecture/SKILL.md': '',
    'skills/ado-work-items/SKILL.md': '',
    '.claude/commands/deploy.md': '',
    'plugins/one/plugin.json': '',
    'src/_adapters/http.ts': '',
    'lib/adapters/db.ts': '',
  });
  const r = extractExtPoints(root);
  const byName = Object.fromEntries(r.points.map(p => [p.name, p]));
  assert.equal(byName.skill.count, 2);
  assert.deepEqual(byName.skill.installed, ['ado-work-items', 'architecture']);
  assert.equal(byName.command.count, 1);
  assert.deepEqual(byName.command.installed, ['deploy']);
  assert.deepEqual(byName.plugin.installed, ['one']);
  assert.deepEqual(byName._adapters.installed, ['http.ts']);
  assert.deepEqual(byName.adapters.installed, ['db.ts']);
});

test('custom registries override defaults; empty registry reports count 0', () => {
  const root = project({ 'evals/architecture/case1.json': '' });
  const r = extractExtPoints(root, [{ name: 'eval-case', glob: 'evals/*/*.json' }, { name: 'nothing', glob: 'nope/*' }]);
  assert.deepEqual(r.points.map(p => p.name), ['eval-case', 'nothing']);
  assert.equal(r.points[0].count, 1);
  assert.deepEqual(r.points[0].installed, ['case1']);
  assert.equal(r.points[1].count, 0);
  assert.deepEqual(r.points[1].installed, []);
});

test('node_modules and .git are never walked', () => {
  const root = project({ 'node_modules/plugins/x/plugin.json': '', '.git/plugins/y': '' });
  const r = extractExtPoints(root, [{ name: 'plugin', glob: 'plugins/*' }]);
  assert.equal(r.points[0].count, 0);
});
