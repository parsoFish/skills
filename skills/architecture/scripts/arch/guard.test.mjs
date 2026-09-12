import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshot, verify, kitShapedQuestions, guardReport, writeSnapshot, readSnapshot } from './guard.mjs';

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
