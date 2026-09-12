import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from './check.mjs';

function docs(files) { const root = mkdtempSync(join(tmpdir(), 'docs-')); for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); } return root; }

test('clean docs tree passes', () => {
  const r = check(docs({ 'architecture/overview.md': '# o\n', 'architecture/CHECKLIST.md': '| view | status |\n|---|---|\n| context | ✓ |\n| iac | n/a: no terraform |\n', 'reference/deps.md': 'generated 2026-09-12 by arch extract deps\n' }));
  assert.equal(r.ok, true);
});
test('size cap ignores reference and archive', () => {
  const big = 'x\n'.repeat(500);
  const r = check(docs({ 'architecture/CHECKLIST.md': '| view |\n|---|\n| a | ✓ |\n', 'reference/gen.md': 'generated x\n' + big, 'architecture/archive/old.md': big, 'architecture/overview.md': big }));
  const rule = r.results.find(x => x.id === 'docs.size-cap');
  assert.equal(rule.ok, false); assert.deepEqual(rule.detail, ['architecture/overview.md 501']);
});
test('reference files need a generated header; blank checklist rows fail; retired terms fail', () => {
  const r = check(docs({ 'architecture/CHECKLIST.md': '| view |\n|---|\n| a |  |\n', 'reference/x.md': 'hand written\n', 'architecture/g.md': 'the old Widget name\n' }), { retired: ['Widget'] });
  assert.equal(r.results.find(x => x.id === 'docs.reference-generated').ok, false);
  assert.equal(r.results.find(x => x.id === 'docs.no-blank-checklist').ok, false);
  assert.deepEqual(r.results.find(x => x.id === 'naming.retired').detail, ['architecture/g.md']);
});
