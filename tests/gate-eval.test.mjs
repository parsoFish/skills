import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caseNames, evalCoverage, readEvalResult, aggregateEvals, harnessProblem, sandboxEnv, canReuseEval, versionDrift } from '../scripts/gate/eval.mjs';

const CFG = { threshold: 0.8, minDelta: 0.25 };

function withArm(overrides = {}) { return { turns: 10, costUsd: 1, error: null, skippedPaidGraders: false, ...overrides }; }
function evalJson({ score = 1, scoreWithout = 0, delta = 1, partial = false, arms = { with: [withArm()], without: [withArm({ turns: 3 })] }, costUsd = 1, durationSeconds = 100 } = {}) {
  return { partial, costUsd, durationSeconds, cases: [{ name: 'c', aggregates: { score, scoreWithout, delta }, arms }] };
}

test('readEvalResult passes only when score >= threshold AND delta >= minDelta AND partial is false AND no arm errored AND paid graders were not skipped', () => {
  const r = readEvalResult(evalJson(), CFG);
  assert.equal(r.ok, true);
  assert.equal(r.score, 1);
  assert.equal(r.scoreWithout, 0);
  assert.equal(r.delta, 1);
  assert.equal(r.turns, 10, 'turns come from the with-arm run');
});

test('readEvalResult fails a high score with a delta below minDelta, naming the delta as the cause', () => {
  const r = readEvalResult(evalJson({ score: 1, scoreWithout: 1, delta: 0 }), CFG);
  assert.equal(r.ok, false);
  assert.equal(r.delta, 0);
  assert.equal(r.score, 1, 'the score itself was fine — delta is what failed it');
});

test('readEvalResult fails when partial is true even with a perfect score', () => {
  const r = readEvalResult(evalJson({ partial: true }), CFG);
  assert.equal(r.ok, false);
  assert.equal(r.partial, true);
});

test('readEvalResult fails when any arm carries an error', () => {
  const r = readEvalResult(evalJson({ arms: { with: [withArm({ error: 'boom' })], without: [withArm()] } }), CFG);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['boom']);
});

test('readEvalResult fails when the with-arm skipped a paid grader (budget exhaustion mid-run)', () => {
  const r = readEvalResult(evalJson({ arms: { with: [withArm({ skippedPaidGraders: true })], without: [withArm()] } }), CFG);
  assert.equal(r.ok, false);
  assert.equal(r.skippedPaidGraders, true);
});

test('readEvalResult fails below threshold', () => {
  assert.equal(readEvalResult(evalJson({ score: 0.5, scoreWithout: 0, delta: 0.5 }), CFG).ok, false);
});

test('readEvalResult never crashes on a result with no case (harness failure before any case ran)', () => {
  const r = readEvalResult({ partial: false, cases: [] }, CFG);
  assert.equal(r.ok, false);
  assert.equal(r.partial, true);
  assert.ok(r.errors.length > 0);
});

test('aggregateEvals requires every case to pass and reports the minimum score', () => {
  const a = aggregateEvals([{ name: 'a', ok: true, exit: 0, score: 1, delta: 1 }, { name: 'b', ok: true, exit: 0, score: 0.9, delta: 0.5 }]);
  assert.equal(a.ok, true);
  assert.equal(a.score, 0.9);
  assert.deepEqual(a.cases.map(c => c.delta), [1, 0.5]);
});

test('aggregateEvals fails overall when any single case fails, and on empty input', () => {
  assert.equal(aggregateEvals([{ name: 'a', ok: true, exit: 0, score: 1 }, { name: 'b', ok: false, exit: 0, score: 0.4 }]).ok, false);
  assert.equal(aggregateEvals([{ name: 'a', ok: true, exit: 1, score: 1 }]).ok, false, 'non-zero exit fails even with ok:true');
  assert.deepEqual(aggregateEvals([]), { ok: false, score: null, cases: [] });
});

test('evalCoverage requires a case with a tool_used: Skill grader', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-eval-'));
  assert.equal(evalCoverage(root, 'x').ok, false);
  mkdirSync(join(root, 'evals', 'x', 'c1', 'graders'), { recursive: true });
  writeFileSync(join(root, 'evals', 'x', 'c1', 'prompt.md'), 'do x');
  assert.equal(evalCoverage(root, 'x').ok, false, 'case without Skill grader');
  writeFileSync(join(root, 'evals', 'x', 'c1', 'graders', 'fired.md'), '---\ntype: tool_used\ntool: Skill\n---\nfired\n');
  assert.deepEqual(evalCoverage(root, 'x'), { ok: true, cases: 1, detail: '' });
});

test('caseNames lists case dirs with a prompt.md or case.yaml, sorted', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-eval-'));
  assert.deepEqual(caseNames(root, 'x'), []);
  mkdirSync(join(root, 'evals', 'x', 'b'), { recursive: true });
  mkdirSync(join(root, 'evals', 'x', 'a'), { recursive: true });
  writeFileSync(join(root, 'evals', 'x', 'b', 'prompt.md'), 'b');
  writeFileSync(join(root, 'evals', 'x', 'a', 'case.yaml'), 'a');
  assert.deepEqual(caseNames(root, 'x'), ['a', 'b']);
});

test('harnessProblem names the machine-side cause and remedy instead of a silent zero', () => {
  const j = { cases: [{ arms: { with: [{ error: 'A shell tool (Bash) was granted but this machine cannot confine it (no sandbox backend)' }] } }] };
  assert.match(harnessProblem(j), /bubblewrap/);
  assert.equal(harnessProblem({ cases: [{ arms: { with: [{ error: null, score: 1 }] } }] }), '');
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

test('canReuseEval: only a result started after the last change to the skill is reusable', () => {
  const t = 1_700_000_000;
  const at = epoch => new Date(epoch * 1000).toISOString();
  assert.equal(canReuseEval({ startedAt: at(t + 60) }, t), true);
  assert.equal(canReuseEval({ startedAt: at(t - 60) }, t), false);
  assert.equal(canReuseEval({ startedAt: at(t + 60) }, null), false);
  assert.equal(canReuseEval({}, t), false);
  assert.equal(canReuseEval(null, t), false);
});

test('reuseCandidates lists the raw per-case JSON first and the tracked evidence copy second, only when present', async () => {
  const { reuseCandidates } = await import('../scripts/gate/agentic.mjs');
  const root = mkdtempSync(join(tmpdir(), 'reuse-'));
  mkdirSync(join(root, 'evals', 'attest'), { recursive: true });
  assert.deepEqual(reuseCandidates(root, 'c'), []);
  writeFileSync(join(root, 'evals', 'attest', 'c.json'), '{}');
  assert.deepEqual(reuseCandidates(root, 'c'), [join(root, 'evals', 'attest', 'c.json')]);
  writeFileSync(join(root, 'evals', 'gate-eval-c.json'), '{}');
  assert.deepEqual(reuseCandidates(root, 'c'), [join(root, 'evals', 'gate-eval-c.json'), join(root, 'evals', 'attest', 'c.json')]);
});

test('attestedForSameContent: a prior attested report with the same skillsDigest covers a case that has evidence, nothing else', async () => {
  const { attestedForSameContent } = await import('../scripts/gate/agentic.mjs');
  const prior = { schema: 2, attested: true, skillsDigest: 'abc', eval: { cases: [{ name: 'c1', evidence: 'evals/attest/c1.json' }, { name: 'c2' }] } };
  assert.equal(attestedForSameContent(prior, 'abc', 'c1'), true);
  assert.equal(attestedForSameContent(prior, 'abc', 'c2'), false, 'no evidence path');
  assert.equal(attestedForSameContent(prior, 'zzz', 'c1'), false, 'digest differs');
  assert.equal(attestedForSameContent({ ...prior, attested: false }, 'abc', 'c1'), false);
  assert.equal(attestedForSameContent(null, 'abc', 'c1'), false);
});

test('sandboxEnv disables the Claude Code auto-updater so the binary cannot be replaced under a running case', () => {
  const env = sandboxEnv({ PATH: '/usr/bin', HOME: '/h' }, { readable: () => true, tmpHome: () => '/tmp/gh', link: () => {}, copy: () => {} });
  assert.equal(env.DISABLE_AUTOUPDATER, '1');
});

test('harnessProblem names the auto-update race when a case died spawning the claude binary', () => {
  const j = { cases: [{ arms: { with: [{ error: "Error: EACCES: permission denied, posix_spawn '/x/node_modules/@anthropic-ai/claude-code/bin/claude.exe'" }] } }] };
  assert.match(harnessProblem(j), /auto-update/);
  assert.match(harnessProblem(j), /--reuse-evals/);
});

test('versionDrift is silent when the CLI version is unchanged or unknown, and names both versions when it changed', () => {
  assert.equal(versionDrift('2.1.269', '2.1.269'), '');
  assert.equal(versionDrift('2.1.269', null), '');
  assert.equal(versionDrift(null, '2.1.274'), '');
  const msg = versionDrift('2.1.269', '2.1.274');
  assert.match(msg, /2\.1\.269/);
  assert.match(msg, /2\.1\.274/);
  assert.match(msg, /--reuse-evals/);
});

test('attestedForSameSkillContent: a prior report covers a case when that skill\'s own digest is unchanged, whatever happened to other skills', async () => {
  const { attestedForSameSkillContent } = await import('../scripts/gate/agentic.mjs');
  const prior = { schema: 2, attested: true, skillsDigest: 'whole-tree-old', skillDigests: { architecture: 'arch1', 'skill-dev': 'sd1' }, eval: { cases: [{ name: 'c1', skill: 'architecture', evidence: 'evals/attest/c1.json' }, { name: 'c2', skill: 'skill-dev' }] } };
  assert.equal(attestedForSameSkillContent(prior, 'architecture', 'arch1', 'c1'), true);
  assert.equal(attestedForSameSkillContent(prior, 'architecture', 'arch2', 'c1'), false, 'skill digest differs');
  assert.equal(attestedForSameSkillContent(prior, 'skill-dev', 'sd1', 'c2'), false, 'no evidence path');
  assert.equal(attestedForSameSkillContent({ ...prior, skillDigests: undefined }, 'architecture', 'arch1', 'c1'), false, 'a report from before per-skill digests never matches');
  assert.equal(attestedForSameSkillContent({ ...prior, attested: false }, 'architecture', 'arch1', 'c1'), false);
});
