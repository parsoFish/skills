#!/usr/bin/env node
// Local gate for skill changes. Every added or changed skill must pass, in order:
//   1 deterministic: skills lint · script tests · `claude plugin validate --strict` · skill-creator
//     quick_validate · has an eval case with a Skill grader
//   2 agentic (spends money, bounded): `claude plugin eval` on the changed skills' cases, then a
//     headless structural review with a structured verdict
// Usage: node scripts/gate.mjs [--base <ref>] [--all] [--force] [--no-agentic] [--no-review]
//        [--verify-only] [--reuse-evals] [--max-cost-usd N] [--eval-model M] [--judge-model M] [--review-model M]
//        [--review-budget-usd N]
// Exactly one verdict line, always: `gate: PASS (attested <digest12>)` exit 0 ·
// `gate: DETERMINISTIC ONLY — not a merge gate` exit 0 · `gate: FAIL <step>` exit 1.
// SKILLS_GATE_SKIP_AGENTIC=1 alone exits 1; paired with SKILLS_GATE_BYPASS_REASON it exits 0 and the
// report records the bypass (attest verify never accepts a bypassed report, so a bypass can be
// pushed but never merged once `attested` is a required check).
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGateConfig } from './gate/config.mjs';
import { resolveBase, changedScope, changedPaths, createGit, shStrict } from './gate/scope.mjs';
import { runDeterministicChecks } from './gate/deterministic.mjs';
import { runAgentic } from './gate/agentic.mjs';
import { baseReport, writeReportFile, printPass, printDeterministicOnly, printFail, claudeVersionFromOutput, pluginVersion } from './gate/verdict.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const has = f => argv.includes(f);
  const flag = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  return {
    all: has('--all'), force: has('--force'), noAgentic: has('--no-agentic'), noReview: has('--no-review'),
    verifyOnly: has('--verify-only'), reuseEvals: has('--reuse-evals'), base: flag('--base'), maxCostUsd: flag('--max-cost-usd'),
    evalModel: flag('--eval-model'), judgeModel: flag('--judge-model'), reviewModel: flag('--review-model'),
    reviewBudgetUsd: flag('--review-budget-usd'),
  };
}

/** Pure: what to do before the deterministic checks even run. A silent env-var skip is a bypass
 * attempt, not a supported mode, so it fails outright unless it names a reason; --no-agentic and
 * --verify-only are the supported, always-allowed ways to skip agentic spend. */
export function preDeterministicRoute({ scope, envSkip, bypassReason, args }) {
  if (!scope.skills.length && !scope.harness) return 'noop';
  if (envSkip && !bypassReason && !args.noAgentic && !args.verifyOnly && scope.skills.length) return 'misuse';
  return 'run-deterministic';
}

/** Pure: once the deterministic checks have passed, which path finishes the run. */
export function postDeterministicRoute({ scope, args, envSkip, bypassReason }) {
  if (args.verifyOnly) return { kind: 'verify-only' };
  if (!scope.skills.length) return { kind: 'harness-only' };
  if (args.noAgentic) return { kind: 'deterministic-only', bypass: null };
  if (envSkip && bypassReason) return { kind: 'deterministic-only', bypass: bypassReason };
  return { kind: 'agentic' };
}

function sh(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, ...opts });
  return { status: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function headCommit() { return shStrict(['rev-parse', 'HEAD'], { cwd: ROOT }).trim(); }

async function importAttest() {
  try { return await import('./attest.mjs'); }
  catch (err) { throw new Error(`scripts/attest.mjs is required for --verify-only but could not be imported (${err.message})`); }
}

async function main() {
  const config = loadGateConfig(ROOT);
  const args = parseArgs(process.argv.slice(2));

  let scope;
  if (args.all) scope = { skills: readdirSync(join(ROOT, 'skills')), harness: true };
  const base = resolveBase(args.base, createGit(ROOT)); // resolved once; the raw --base (e.g. @{upstream}) may not exist
  if (!args.all) scope = changedScope(changedPaths(ROOT, base), readdirSync(join(ROOT, 'skills')));

  const envSkip = process.env.SKILLS_GATE_SKIP_AGENTIC === '1';
  const bypassReason = process.env.SKILLS_GATE_BYPASS_REASON || null;
  const meta = { commit: headCommit(), claudeVersion: claudeVersionFromOutput(sh('claude', ['--version']).out), pluginVersion: pluginVersion(ROOT) };

  const pre = preDeterministicRoute({ scope, envSkip, bypassReason, args });
  if (pre === 'noop') { console.log('gate: nothing changed — skipping (report left untouched)'); process.exitCode = 0; return; }
  console.log(scope.skills.length ? `gate: changed skills → ${scope.skills.join(', ')}` : 'gate: no skill changed — deterministic checks only, attestation untouched');
  // --verify-only judges the tracked attestation; it must never overwrite it, even when it fails.
  const record = report => { if (!args.verifyOnly) writeReportFile(ROOT, report); };
  if (pre === 'misuse') {
    record(baseReport({ scope, steps: [{ name: 'agentic phase', ok: false, detail: 'SKILLS_GATE_SKIP_AGENTIC=1 without SKILLS_GATE_BYPASS_REASON' }], ok: false, ...meta }));
    return printFail('agentic phase');
  }

  const det = runDeterministicChecks({ root: ROOT, scope, sh });
  for (const s of det.steps) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name}${s.detail ? ' — ' + s.detail.split('\n')[0] : ''}`);
  if (!det.ok) {
    record(baseReport({ scope, steps: det.steps, ok: false, ...meta }));
    return printFail(det.steps.find(s => !s.ok).name);
  }

  const post = postDeterministicRoute({ scope, args, envSkip, bypassReason });
  if (post.kind === 'verify-only') {
    const attest = await importAttest();
    const v = attest.verify(ROOT, { base, now: new Date(), config });
    return v.ok ? printPass(attest.skillsDigest(ROOT).slice(0, 12)) : printFail(`attest verify: ${v.reasons.join('; ')}`);
  }
  if (post.kind === 'harness-only') return printDeterministicOnly(); // attestation left exactly as it was
  if (post.kind === 'deterministic-only') {
    writeReportFile(ROOT, { ...baseReport({ scope, steps: det.steps, ok: true, ...meta }), bypass: post.bypass });
    return printDeterministicOnly();
  }
  return runAgentic({ root: ROOT, scope, config, args, det, sh, ...meta });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`gate: ${err.message}`); process.exitCode = 1; });
}
