import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs, preDeterministicRoute, postDeterministicRoute } from '../scripts/gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(ROOT, 'scripts', 'gate.mjs');

test('parseArgs reads every flag the gate accepts, with sensible absent-flag defaults', () => {
  const args = parseArgs(['--all', '--force', '--no-agentic', '--no-review', '--verify-only', '--base', 'origin/main', '--max-cost-usd', '10']);
  assert.equal(args.all, true);
  assert.equal(args.force, true);
  assert.equal(args.noAgentic, true);
  assert.equal(args.noReview, true);
  assert.equal(args.verifyOnly, true);
  assert.equal(args.base, 'origin/main');
  assert.equal(args.maxCostUsd, '10');

  const empty = parseArgs([]);
  assert.equal(empty.all, false);
  assert.equal(empty.base, undefined);
});

test('preDeterministicRoute: nothing changed at all is a pure no-op', () => {
  assert.equal(preDeterministicRoute({ scope: { skills: [], harness: false }, envSkip: false, bypassReason: null, args: {} }), 'noop');
});

test('preDeterministicRoute: SKILLS_GATE_SKIP_AGENTIC=1 without a reason is a misuse failure whenever a skill actually changed', () => {
  assert.equal(preDeterministicRoute({ scope: { skills: ['a'], harness: false }, envSkip: true, bypassReason: null, args: {} }), 'misuse');
});

test('preDeterministicRoute: the env skip is not misuse when a bypass reason is given, or when --no-agentic/--verify-only already sanctions the skip', () => {
  assert.equal(preDeterministicRoute({ scope: { skills: ['a'], harness: false }, envSkip: true, bypassReason: 'ci key rotation', args: {} }), 'run-deterministic');
  assert.equal(preDeterministicRoute({ scope: { skills: ['a'], harness: false }, envSkip: true, bypassReason: null, args: { noAgentic: true } }), 'run-deterministic');
  assert.equal(preDeterministicRoute({ scope: { skills: ['a'], harness: false }, envSkip: true, bypassReason: null, args: { verifyOnly: true } }), 'run-deterministic');
});

test('preDeterministicRoute: harness-only changes (no skill) still run the deterministic half', () => {
  assert.equal(preDeterministicRoute({ scope: { skills: [], harness: true }, envSkip: false, bypassReason: null, args: {} }), 'run-deterministic');
});

test('postDeterministicRoute: --verify-only always wins, spending nothing on eval/review', () => {
  assert.deepEqual(postDeterministicRoute({ scope: { skills: ['a'], harness: false }, args: { verifyOnly: true }, envSkip: false, bypassReason: null }), { kind: 'verify-only' });
});

test('postDeterministicRoute: no skill changed (harness-only) means nothing to gate agentically', () => {
  assert.deepEqual(postDeterministicRoute({ scope: { skills: [], harness: true }, args: {}, envSkip: false, bypassReason: null }), { kind: 'harness-only' });
});

test('postDeterministicRoute: --no-agentic skips agentic without recording a bypass reason', () => {
  assert.deepEqual(postDeterministicRoute({ scope: { skills: ['a'], harness: false }, args: { noAgentic: true }, envSkip: false, bypassReason: null }), { kind: 'deterministic-only', bypass: null });
});

test('postDeterministicRoute: an env-var skip with a reason records that reason as the bypass', () => {
  assert.deepEqual(postDeterministicRoute({ scope: { skills: ['a'], harness: false }, args: {}, envSkip: true, bypassReason: 'harness broken' }), { kind: 'deterministic-only', bypass: 'harness broken' });
});

test('postDeterministicRoute: otherwise, a real skill change with no skip flag runs the agentic phase', () => {
  assert.deepEqual(postDeterministicRoute({ scope: { skills: ['a'], harness: false }, args: {}, envSkip: false, bypassReason: null }), { kind: 'agentic' });
});

// --- Real-process check for the one bypass exit code that never touches attest.mjs/report.mjs or the
// agentic half: SKILLS_GATE_SKIP_AGENTIC=1 alone must fail the whole run before spending anything.
function misuseFixture() {
  const root = mkdtempSync(join(tmpdir(), 'gate-misuse-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'a'], { cwd: root });
  mkdirSync(join(root, 'skills', 'dummy'), { recursive: true });
  writeFileSync(join(root, 'skills', 'dummy', 'SKILL.md'), 'x');
  writeFileSync(join(root, 'gate.config.json'), JSON.stringify({ threshold: 0.8, minDelta: 0.25, maxCostUsd: 5, reviewBudgetUsd: 2, evalModel: 'claude-sonnet-5', judgeModel: 'claude-haiku-4-5', reviewModel: 'claude-sonnet-5', maxAttestationAgeDays: 30, resultsKeep: 3 }));
  mkdirSync(join(root, 'scripts', 'gate'), { recursive: true });
  copyFileSync(GATE, join(root, 'scripts', 'gate.mjs'));
  copyFileSync(join(ROOT, 'scripts', 'clean.mjs'), join(root, 'scripts', 'clean.mjs'));
  for (const f of ['config.mjs', 'scope.mjs', 'eval.mjs', 'review.mjs', 'deterministic.mjs', 'ledger.mjs', 'verdict.mjs', 'agentic.mjs']) {
    copyFileSync(join(ROOT, 'scripts', 'gate', f), join(root, 'scripts', 'gate', f));
  }
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

test('SKILLS_GATE_SKIP_AGENTIC=1 alone exits 1 before running any deterministic step (fails fast on the misuse, not on a missing plugin)', () => {
  const root = misuseFixture();
  let status = 0;
  let out = '';
  try {
    out = execFileSync('node', [join(root, 'scripts', 'gate.mjs'), '--all'], { cwd: root, encoding: 'utf8', env: { ...process.env, SKILLS_GATE_SKIP_AGENTIC: '1' } });
  } catch (err) {
    status = err.status;
    out = (err.stdout ?? '') + (err.stderr ?? '');
  }
  assert.equal(status, 1);
  assert.match(out, /gate: FAIL agentic phase/);
  assert.doesNotMatch(out, /^ok  lint/m, 'the misuse check must fail before lint ever runs');
});


test('gate.mjs hands runAgentic the same meta keys it destructures (a rename here crashed a real run after $9 of evals)', () => {
  const agentic = readFileSync(new URL('../scripts/gate/agentic.mjs', import.meta.url), 'utf8');
  const sig = agentic.match(/export async function runAgentic\(\{([^}]*)\}/)[1].split(',').map(s => s.trim());
  for (const key of ['commit', 'claudeVersion', 'pluginVersion']) assert.ok(sig.includes(key), `runAgentic must destructure ${key}`);
});

test('--verify-only never writes evals/gate-report.json: a failing deterministic step in the hook must not clobber the tracked attestation', () => {
  const src = readFileSync(new URL('../scripts/gate.mjs', import.meta.url), 'utf8');
  assert.match(src, /const record = report => \{ if \(!args\.verifyOnly\) writeReportFile/);
  const failBlocks = src.split('if (!det.ok) {')[1].split('}')[0];
  assert.ok(failBlocks.includes('record('), 'deterministic failure path must go through record()');
  assert.ok(!failBlocks.includes('writeReportFile('), 'deterministic failure path must not call writeReportFile directly');
});

test('the verify-only path hands attest the resolved base, never the raw --base string (a first push has no @{upstream})', () => {
  const src = readFileSync(new URL('../scripts/gate.mjs', import.meta.url), 'utf8');
  assert.match(src, /const base = resolveBase\(args\.base, createGit\(ROOT\)\)/);
  assert.match(src, /attest\.verify\(ROOT, \{ base, /);
  assert.doesNotMatch(src, /attest\.verify\(ROOT, \{ base: args\.base/);
});
