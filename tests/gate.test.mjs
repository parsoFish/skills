import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedSkills, evalCoverage, readEvalResult, contentHash, cachedPass, sandboxEnv, harnessProblem } from '../scripts/gate.mjs';

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

test('contentHash changes with skill content and cachedPass honours ok + agenticRan + hash', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-'));
  mkdirSync(join(root, 'skills', 's'), { recursive: true }); writeFileSync(join(root, 'skills', 's', 'SKILL.md'), 'a');
  const h1 = contentHash(root, ['s']);
  writeFileSync(join(root, 'skills', 's', 'SKILL.md'), 'b');
  const h2 = contentHash(root, ['s']);
  assert.notEqual(h1, h2);
  const rp = join(root, 'report.json');
  writeFileSync(rp, JSON.stringify({ ok: true, agenticRan: true, contentHash: h2, eval: { score: 0.9 } }));
  assert.equal(cachedPass(rp, h2)?.eval.score, 0.9);
  assert.equal(cachedPass(rp, h1), null, 'different content is not a cached pass');
  writeFileSync(rp, JSON.stringify({ ok: true, agenticRan: false, agenticSkipped: true, contentHash: h2 }));
  assert.equal(cachedPass(rp, h2), null, 'a skipped agentic phase never counts as a pass');
});

test('sandboxEnv drops unreadable PATH entries and swaps in a throwaway HOME that keeps Claude auth but no Docker config', () => {
  const links = [], copies = [];
  const env = sandboxEnv({ PATH: '/usr/bin:/mnt/c/Windows:/opt/x', HOME: '/h' }, { readable: d => d === '/usr/bin' || d === '/opt/x', tmpHome: () => '/tmp/gh', link: (t, p) => links.push([t, p]), copy: (a, b) => copies.push([a, b]) });
  assert.equal(env.PATH, '/usr/bin:/opt/x');
  assert.equal(env.HOME, '/tmp/gh');
  assert.deepEqual(links, [['/h/.claude', '/tmp/gh/.claude']]);
  assert.deepEqual(copies, [['/h/.claude.json', '/tmp/gh/.claude.json']]);
  assert.equal(env.DOCKER_CONFIG, '/tmp/gh/.docker-none');
});

test('harnessProblem names the machine-side cause and remedy instead of a silent zero', () => {
  const j = { cases: [{ arms: { with: [{ error: 'A shell tool (Bash) was granted but this machine cannot confine it (no sandbox backend)' }] } }] };
  assert.match(harnessProblem(j), /bubblewrap/);
  assert.equal(harnessProblem({ cases: [{ arms: { with: [{ error: null, score: 1 }] } }] }), '');
});
