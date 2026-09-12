import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshot, verify, kitShapedQuestions, guardReport, writeSnapshot, readSnapshot, isOpen, close } from './guard.mjs';

function docs() {
  const root = mkdtempSync(join(tmpdir(), 'guard-'));
  const w = (p, c) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); };
  w('reference/deps.md', 'generated\n'); w('reference/views/index.png', 'png'); w('architecture/CHECKLIST.md', '| view |\n'); w('architecture/_run/gaps.json', '[]'); w('architecture/risks.md', 'mine\n');
  return root;
}

test('verify passes when kit-owned files are untouched and ignores views + written docs', () => {
  const root = docs(); const s = snapshot(root);
  writeFileSync(join(root, 'architecture', 'risks.md'), 'edited by the agent\n');
  writeFileSync(join(root, 'reference', 'views', 'index.png'), 're-rendered');
  assert.equal(verify(root, s).ok, true);
});

test('verify reports modified, deleted and added kit-owned files', () => {
  const root = docs(); const s = snapshot(root);
  writeFileSync(join(root, 'architecture', 'CHECKLIST.md'), '| view | edited |\n');
  writeFileSync(join(root, 'reference', 'extra.md'), 'sneaky\n');
  const v = verify(root, s);
  assert.equal(v.ok, false); assert.deepEqual(v.modified, ['architecture/CHECKLIST.md']); assert.deepEqual(v.added, ['reference/extra.md']);
});

test('kit-shaped questions are detected by title', () => {
  const md = '### Q1 · Which archetype is this project?   id: kind-ambiguous\n### Q2 · Should the deps extractor regex catch dynamic import()?   id: x\n';
  assert.deepEqual(kitShapedQuestions(md), ['Q2 · Should the deps extractor regex catch dynamic import()?   id: x']);
});

test('guardReport combines both checks and snapshot round-trips through disk', () => {
  const root = docs(); mkdirSync(join(root, 'architecture', '_run'), { recursive: true });
  writeSnapshot(root); const s = readSnapshot(root);
  writeFileSync(join(root, 'architecture', '_run', 'interview.md'), '### Q1 · Fix the renderer?   id: r\n');
  const g = guardReport(root, s);
  assert.equal(g.ok, false); assert.equal(g.kitShaped.length, 1); assert.match(g.text, /untouched: yes/);
});

test('writeSnapshot records pid and an ISO timestamp alongside the hashes', () => {
  const root = docs(); mkdirSync(join(root, 'architecture', '_run'), { recursive: true });
  writeSnapshot(root);
  const s = readSnapshot(root);
  assert.equal(s.pid, process.pid);
  assert.match(s.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(s.hashes && Object.keys(s.hashes).length > 0);
});

test('isOpen is true once a stage-2 snapshot exists, false before it and after close', () => {
  const root = docs();
  assert.equal(isOpen(root), false); // no snapshot yet
  mkdirSync(join(root, 'architecture', '_run'), { recursive: true });
  writeSnapshot(root);
  assert.equal(isOpen(root), true);
  const p = close(root);
  assert.ok(existsSync(p));
  assert.equal(isOpen(root), false);
});

test('verify fails with a false-green reason when review.md claims all rules pass but fitness disagrees', () => {
  const root = docs(); const s = snapshot(root);
  mkdirSync(join(root, 'architecture', '_run'), { recursive: true });
  writeFileSync(join(root, 'architecture', '_run', 'review.md'), 'Summary: all rules pass, ship it.\n');
  const failingFitness = { ok: false, results: [{ id: 'naming.retired', ok: false, detail: [] }] };
  const v = verify(root, s, { fitness: failingFitness });
  assert.equal(v.ok, false);
  assert.deepEqual(v.reasons, ['review claims green while fitness has failing rules']);
});

test('verify does not false-green when fitness actually passes, or when review.md makes no green claim, or when fitness is omitted', () => {
  const root = docs(); const s = snapshot(root);
  mkdirSync(join(root, 'architecture', '_run'), { recursive: true });
  writeFileSync(join(root, 'architecture', '_run', 'review.md'), 'Summary: all rules pass.\n');
  assert.deepEqual(verify(root, s, { fitness: { ok: true, results: [] } }).reasons, []);
  assert.deepEqual(verify(root, s).reasons, []); // fitness not passed at all: backward compatible

  writeFileSync(join(root, 'architecture', '_run', 'review.md'), 'Summary: 2 rules still failing, do not merge.\n');
  assert.deepEqual(verify(root, s, { fitness: { ok: false, results: [] } }).reasons, []);
});

test('guardReport surfaces the false-green reason line when fitness is passed through', () => {
  const root = docs(); mkdirSync(join(root, 'architecture', '_run'), { recursive: true });
  writeSnapshot(root); const s = readSnapshot(root);
  writeFileSync(join(root, 'architecture', '_run', 'review.md'), 'all rules ok\n');
  const g = guardReport(root, s, { fitness: { ok: false, results: [{ id: 'x', ok: false, detail: [] }] } });
  assert.equal(g.ok, false);
  assert.match(g.text, /reason: review claims green while fitness has failing rules/);
});
