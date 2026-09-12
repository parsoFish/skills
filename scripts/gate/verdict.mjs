// Schema-2 report assembly and the three unambiguous verdict lines (B3). Every gate run ends by
// printing exactly one of these — never a fourth, ad hoc "sort of passed" line.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { aggregateEvals } from './eval.mjs';

export function printPass(digest12) {
  console.log(`gate: PASS (attested ${digest12})`);
  process.exitCode = 0;
}

export function printDeterministicOnly() {
  console.log('gate: DETERMINISTIC ONLY — not a merge gate');
  process.exitCode = 0;
}

export function printFail(step) {
  console.log(`gate: FAIL ${step}`);
  process.exitCode = 1;
}

export function claudeVersionFromOutput(out) {
  const m = out.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

export function pluginVersion(root) {
  try {
    return JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/** Pure: the eval section of the schema-2 report from per-case results already carrying `ok`. */
export function evalSection(config, perCase) {
  return { threshold: config.threshold, minDelta: config.minDelta, cases: aggregateEvals(perCase).cases };
}

/** Pure: the schema-2 report shape with the fields every path fills in, so branches only need to
 * override what differs (agenticRan, attested, eval, review, totals, digests). */
export function baseReport({ scope, steps, ok, commit, claudeVersion, pluginVersion: pv }) {
  return {
    schema: 2, ok, attested: false, agenticRan: false, bypass: null,
    generatedAt: new Date().toISOString(), commit, claudeVersion, pluginVersion: pv,
    scope, changed: scope.skills, steps,
    eval: null, review: null, totals: { costUsd: 0, durationSeconds: 0 },
    skillsDigest: null, harnessDigest: null,
  };
}

export function writeReportFile(root, report) {
  const out = join(root, 'evals', 'gate-report.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
  return out;
}
