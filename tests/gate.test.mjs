import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedSkills, evalCoverage, readEvalResult } from '../scripts/gate.mjs';

test('changedSkills maps skill and eval paths to skill names, deduplicated and sorted', () => {
  assert.deepEqual(changedSkills(['skills/b/SKILL.md', 'evals/a/case/prompt.md', 'skills/b/scripts/x.mjs', 'README.md', 'scripts/gate.mjs']), ['a', 'b']);
  assert.deepEqual(changedSkills([]), []);
});

test('evalCoverage requires a case with a tool_used: Skill grader', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-'));
  assert.equal(evalCoverage(root, 'x').ok, false);
  mkdirSync(join(root, 'evals', 'x', 'c1', 'graders'), { recursive: true });
  writeFileSync(join(root, 'evals', 'x', 'c1', 'prompt.md'), 'do x');
  assert.equal(evalCoverage(root, 'x').ok, false, 'case without Skill grader');
  writeFileSync(join(root, 'evals', 'x', 'c1', 'graders', 'fired.md'), '---\ntype: tool_used\ntool: Skill\n---\nfired\n');
  assert.deepEqual(evalCoverage(root, 'x'), { ok: true, cases: 1, detail: '' });
});

test('readEvalResult applies the threshold and surfaces per-case deltas', () => {
  const r = readEvalResult({ aggregates: { overallScore: 0.9 }, cases: [{ name: 'c', aggregates: { score: 0.9, delta: 0.4 } }] }, 0.8);
  assert.equal(r.ok, true); assert.deepEqual(r.cases, [{ name: 'c', score: 0.9, delta: 0.4 }]);
  assert.equal(readEvalResult({ aggregates: { overallScore: 0.5 } }).ok, false);
  assert.equal(readEvalResult({}).ok, false, 'no score is a failure, never a pass');
});
