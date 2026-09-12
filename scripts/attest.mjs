#!/usr/bin/env node
// Attestation: verifies that evals/gate-report.json (schema 2) is still true of the tree it is being
// checked against. skillsDigest/harnessDigest are computed from git blob SHAs, so CI recomputes them
// byte-for-byte from a fresh checkout — see docs/gate-runbook.md for what each failure reason means
// and how to fix it.
// Usage: node scripts/attest.mjs verify [--base <ref>]
//        node scripts/attest.mjs digest
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillsDigest, harnessDigest, dirtyPaths } from './attest/digest.mjs';
import { copyEvidence } from './attest/evidence.mjs';
import { loadConfig } from './attest/config.mjs';
import { diffNameOnly, changedSkillNames } from './attest/git.mjs';
import { checkAttestationFlags, checkDigests, checkAncestor, checkSkillCoverage, checkFreshness, checkReleaseDiscipline } from './attest/checks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export { skillsDigest, harnessDigest, dirtyPaths, copyEvidence };

function readReport(root) {
  const path = join(root, 'evals', 'gate-report.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** Verifies evals/gate-report.json against the tree at `root`. Never throws on a bad report — a
 * report that fails to parse or carries the wrong schema is exactly what verify exists to catch, so
 * it becomes `{ ok: false, reasons: ['schema mismatch'] }` rather than an unhandled exception. */
export function verify(root, { base = 'origin/main', now = new Date(), config } = {}) {
  const report = readReport(root);
  if (!report || report.schema !== 2) return { ok: false, reasons: ['schema mismatch'] };
  const cfg = config ?? loadConfig(root);

  const reasons = [...checkAttestationFlags(report), ...checkDigests(root, report), ...checkAncestor(root, report)];

  const changedPaths = diffNameOnly(root, base, 'HEAD');
  const knownSkills = existsSync(join(root, 'skills')) ? readdirSync(join(root, 'skills')) : [];
  for (const skill of changedSkillNames(changedPaths, knownSkills)) reasons.push(...checkSkillCoverage(root, report, skill));

  reasons.push(...checkFreshness(report, now, cfg.maxAttestationAgeDays));
  reasons.push(...checkReleaseDiscipline(root, base, 'HEAD', changedPaths));

  if (dirtyPaths(root).length > 0) reasons.push('working tree dirty');

  const deduped = [...new Set(reasons)];
  return { ok: deduped.length === 0, reasons: deduped };
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const flag = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

  if (cmd === 'digest') {
    console.log(`skillsDigest  ${skillsDigest(ROOT)}`);
    console.log(`harnessDigest ${harnessDigest(ROOT)}`);
    return;
  }
  if (cmd === 'verify') {
    const base = flag('--base', 'origin/main');
    const { ok, reasons } = verify(ROOT, { base });
    if (ok) { console.log('attest: verified'); process.exitCode = 0; return; }
    for (const r of reasons) console.error(r);
    process.exitCode = 1;
    return;
  }
  console.error('usage: node scripts/attest.mjs verify [--base <ref>] | digest');
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
