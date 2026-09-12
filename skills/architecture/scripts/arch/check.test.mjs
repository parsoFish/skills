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
test('MISSING rows are explicit (not blank) but fail checklist-complete', () => {
  const r = check(docs({ 'architecture/CHECKLIST.md': '| view | status | where |\n|---|---|---|\n| context | ✓ |  |\n| risks | MISSING |  |\n' }));
  assert.equal(r.results.find(x => x.id === 'docs.no-blank-checklist').ok, true);
  const c = r.results.find(x => x.id === 'docs.checklist-complete');
  assert.equal(c.ok, false); assert.deepEqual(c.detail, ['risks']);
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

test('docs.cited-paths-exist: skipped without root, ok when the cited path exists, fails on a stale citation', () => {
  const rootless = check(docs({ 'architecture/overview.md': 'see scripts/arch/drift.mjs for details\n' }));
  assert.equal(rootless.results.find(x => x.id === 'docs.cited-paths-exist').ok, true);

  const srcRoot = mkdtempSync(join(tmpdir(), 'src-'));
  mkdirSync(join(srcRoot, 'scripts', 'arch'), { recursive: true });
  writeFileSync(join(srcRoot, 'scripts', 'arch', 'drift.mjs'), '// real\n');
  const ok = check(docs({ 'architecture/overview.md': 'see scripts/arch/drift.mjs for details\n' }), { root: srcRoot });
  assert.equal(ok.results.find(x => x.id === 'docs.cited-paths-exist').ok, true);

  const stale = check(docs({ 'architecture/overview.md': 'see scripts/arch/gone.mjs:12 for details\n' }), { root: srcRoot });
  const rule = stale.results.find(x => x.id === 'docs.cited-paths-exist');
  assert.equal(rule.ok, false);
  assert.match(rule.detail[0], /scripts\/arch\/gone\.mjs/);
});

test('docs.cited-paths-exist ignores reference/ docs and URLs', () => {
  const srcRoot = mkdtempSync(join(tmpdir(), 'src-'));
  const r = check(docs({ 'reference/deps.md': 'generated\n\nsee scripts/arch/gone.mjs\n', 'architecture/overview.md': 'see https://example.com/a/b.md for more\n' }), { root: srcRoot });
  assert.equal(r.results.find(x => x.id === 'docs.cited-paths-exist').ok, true);
});

test('docs.cell-length fails on a table cell over 220 characters in a written doc', () => {
  const longCell = 'x'.repeat(221);
  const r = check(docs({ 'architecture/risks.md': `| a | b |\n|---|---|\n| ${longCell} | short |\n` }));
  const rule = r.results.find(x => x.id === 'docs.cell-length');
  assert.equal(rule.ok, false);
  assert.deepEqual(rule.detail, ['architecture/risks.md:3']);
});

test('docs.cell-length passes clean tables and ignores the separator row', () => {
  const r = check(docs({ 'architecture/risks.md': '| a | b |\n|---|---|\n| short | short |\n' }));
  assert.equal(r.results.find(x => x.id === 'docs.cell-length').ok, true);
});

test('docs.view-shape requires a mermaid block or svg in loop/signals/secrets/journeys that exist; others are not required', () => {
  const missing = check(docs({ 'architecture/loop.md': '# loop\nno diagram here\n' }));
  assert.deepEqual(missing.results.find(x => x.id === 'docs.view-shape').detail, ['architecture/loop.md']);

  const ok = check(docs({ 'architecture/loop.md': '# loop\n```mermaid\ngraph TD; a-->b;\n```\n', 'architecture/journeys/happy.md': '<svg></svg>\n' }));
  assert.equal(ok.results.find(x => x.id === 'docs.view-shape').ok, true);

  const noFiles = check(docs({ 'architecture/overview.md': '# o\n' }));
  assert.equal(noFiles.results.find(x => x.id === 'docs.view-shape').ok, true);
});

test('docs.source-sha: skipped without a sha option; passes when the header matches; fails when it does not', () => {
  const skipped = check(docs({ 'reference/deps.md': 'generated\n' }));
  assert.equal(skipped.results.find(x => x.id === 'docs.source-sha').ok, true);

  const ok = check(docs({ 'reference/deps.md': 'generated\nsource: abc123\n' }), { sha: 'abc123' });
  assert.equal(ok.results.find(x => x.id === 'docs.source-sha').ok, true);

  const fail = check(docs({ 'reference/deps.md': 'generated\n' }), { sha: 'abc123' });
  const rule = fail.results.find(x => x.id === 'docs.source-sha');
  assert.equal(rule.ok, false);
  assert.deepEqual(rule.detail, ['reference/deps.md']);
});
