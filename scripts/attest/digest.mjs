// The two content digests attestation is built on, both over `git ls-files -s` blob lines so CI can
// recompute them byte-for-byte from a fresh checkout — no filesystem walk, no untracked junk, no
// symlink or file-order sensitivity (see docs/decisions and review2/contract.md).
import { createHash } from 'node:crypto';
import { lsFiles, statusPorcelain } from './git.mjs';

/** Excluded from skillsDigest and from the dirty-tree check: the attestation's own outputs. Without
 * this exclusion the digest (and the dirty check) would be circular — attesting would change the
 * thing being attested. */
export function isCircularEvalsPath(path) {
  return path.startsWith('evals/results/')
    || path.startsWith('evals/attest/')
    || path === 'evals/gate-report.json'
    || (path.startsWith('evals/gate-eval') && path.endsWith('.json'))
    || path === 'evals/REPORT.md'
    || path === 'evals/ledger.md';
}

function isHarnessFile(path) {
  if (path === 'lint.config.json' || path === 'gate.config.json' || path === 'package.json') return true;
  return path.startsWith('scripts/') && path.endsWith('.mjs') && !path.endsWith('.test.mjs');
}

function digestLines(entries) {
  const lines = entries.map(e => `${e.mode} ${e.blob} ${e.path}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** sha256 over sorted "<mode> <blob> <path>" lines for skills/ + evals/, excluding this attestation's
 * own outputs (see isCircularEvalsPath). */
export function skillsDigest(root) {
  return digestLines(lsFiles(root, ['skills', 'evals']).filter(e => !isCircularEvalsPath(e.path)));
}

/** sha256 over the same shape for ONE skill: skills/<name> plus evals/<name>, excluding attestation
 * outputs. Lets a passing eval result be reused while other skills change around it. */
export function skillDigest(root, skill) {
  return digestLines(lsFiles(root, [`skills/${skill}`, `evals/${skill}`]).filter(e => !isCircularEvalsPath(e.path)));
}

/** sha256 over the same shape for the harness that judges skills: every scripts/**\/*.mjs (never a
 * *.test.mjs) plus the three config files whose values the gate trusts. */
export function harnessDigest(root) {
  return digestLines(lsFiles(root, ['scripts', 'lint.config.json', 'gate.config.json', 'package.json']).filter(e => isHarnessFile(e.path)));
}

/** Non-excluded dirty paths under skills/evals/scripts/config — a digest over uncommitted content is
 * not verifiable, so attest refuses whenever this is non-empty. */
export function dirtyPaths(root) {
  const paths = statusPorcelain(root, ['skills', 'evals', 'scripts', 'lint.config.json', 'gate.config.json', 'package.json']);
  return paths.filter(p => !isCircularEvalsPath(p));
}
