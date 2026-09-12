import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDeterministicChecks } from '../scripts/gate/deterministic.mjs';

function tempSkillsRoot(skills) {
  const root = mkdtempSync(join(tmpdir(), 'gate-det-'));
  for (const s of skills) {
    mkdirSync(join(root, 'evals', s, 'c1', 'graders'), { recursive: true });
    writeFileSync(join(root, 'evals', s, 'c1', 'prompt.md'), 'do it');
    writeFileSync(join(root, 'evals', s, 'c1', 'graders', 'fired.md'), '---\ntype: tool_used\ntool: Skill\n---\n');
  }
  return root;
}

test('runDeterministicChecks runs lint, tests and plugin-validate unconditionally, and reports each step', () => {
  const calls = [];
  const sh = (cmd, argv) => { calls.push([cmd, ...argv].join(' ')); return { status: 0, out: '' }; };
  const root = tempSkillsRoot([]);
  const { ok, steps } = runDeterministicChecks({ root, scope: { skills: [], harness: true }, sh });
  assert.equal(ok, true);
  assert.deepEqual(steps.map(s => s.name), ['lint', 'tests', 'plugin validate --strict']);
  assert.equal(calls.length, 3);
});

test('runDeterministicChecks fails overall when any step fails, but still runs every step (no short-circuit)', () => {
  const sh = (cmd, argv) => (cmd === 'node' ? { status: 1, out: 'lint error' } : { status: 0, out: '' });
  const root = tempSkillsRoot([]);
  const { ok, steps } = runDeterministicChecks({ root, scope: { skills: [], harness: true }, sh });
  assert.equal(ok, false);
  assert.deepEqual(steps.map(s => s.name), ['lint', 'tests', 'plugin validate --strict']);
  assert.equal(steps[0].ok, false);
  assert.equal(steps[1].ok, true, 'tests still ran after lint failed');
});

test('runDeterministicChecks adds a quick_validate + eval-coverage step per changed skill', () => {
  const sh = () => ({ status: 0, out: '' });
  const root = tempSkillsRoot(['architecture']);
  const { steps } = runDeterministicChecks({ root, scope: { skills: ['architecture'], harness: false }, sh });
  const names = steps.map(s => s.name);
  assert.ok(names.some(n => n.startsWith('skill-creator quick_validate architecture')));
  assert.ok(names.some(n => n.startsWith('eval case with Skill grader architecture')));
});

test('runDeterministicChecks fails the quick_validate step (without crashing) when skill-creator is not installed', () => {
  const originalHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'gate-det-home-'));
  try {
    const sh = () => ({ status: 0, out: '' });
    const root = tempSkillsRoot(['architecture']);
    const { ok, steps } = runDeterministicChecks({ root, scope: { skills: ['architecture'], harness: false }, sh });
    assert.equal(ok, false);
    const qv = steps.find(s => s.name.startsWith('skill-creator quick_validate'));
    assert.equal(qv.ok, false);
    assert.match(qv.detail, /not installed/);
  } finally {
    process.env.HOME = originalHome;
  }
});
