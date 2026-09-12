// Each function below returns zero or more of the fixed reason strings from
// docs/roadmaps' review2/contract.md (the runbook has one `### <reason>` heading per string) — verify()
// in scripts/attest.mjs just concatenates and dedupes what these return. Keeping one function per
// concern is what makes "every reason reachable by a fixture" a tractable test matrix.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isAncestor, commitExists, showFileAtRef, diffFile } from './git.mjs';
import { skillsDigest, harnessDigest } from './digest.mjs';

/** attested / agenticRan / bypass — mutually informative but each independently reachable: a bypass
 * explains why attested is false, so it stands alone rather than piling on with 'not attested'. */
export function checkAttestationFlags(report) {
  if (report.bypass) return ['bypass recorded'];
  const reasons = [];
  if (report.agenticRan !== true) reasons.push('agentic did not run');
  if (report.attested !== true) reasons.push('not attested');
  return reasons;
}

export function checkDigests(root, report) {
  const reasons = [];
  if (report.skillsDigest !== skillsDigest(root)) reasons.push('skillsDigest mismatch');
  if (report.harnessDigest !== harnessDigest(root)) reasons.push('harnessDigest mismatch');
  return reasons;
}

/** A commit this clone does not have (the branch was squash-merged and deleted) cannot be judged, so
 * the digests carry the proof alone; a commit that IS here must be in HEAD's history. */
export function checkAncestor(root, report, head = 'HEAD') {
  if (!report.commit) return ['commit not an ancestor of HEAD'];
  if (!commitExists(root, report.commit)) return [];
  return isAncestor(root, report.commit, head) ? [] : ['commit not an ancestor of HEAD'];
}

/** Case dirs actually on disk under evals/<skill>/ — the ground truth coverage is measured against,
 * independent of anything the report claims. */
export function caseDirNames(root, skill) {
  const dir = join(root, 'evals', skill);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(c => existsSync(join(dir, c, 'prompt.md')) || existsSync(join(dir, c, 'case.yaml'))).sort();
}

/** Coverage + per-case gating + review verdict, for one changed skill. */
export function checkSkillCoverage(root, report, skill) {
  const changed = new Set(report.changed ?? []);
  if (!changed.has(skill)) return ['changed skill not covered'];
  const reasons = [];
  const cases = report.eval?.cases ?? [];
  const threshold = report.eval?.threshold;
  const minDelta = report.eval?.minDelta;
  for (const caseName of caseDirNames(root, skill)) {
    const entry = cases.find(c => c.name === caseName && c.skill === skill);
    if (!entry) { reasons.push('case not covered by the attestation'); continue; }
    if (threshold != null && entry.score != null && entry.score < threshold) reasons.push('case below threshold');
    if (minDelta != null && entry.delta != null && entry.delta < minDelta) reasons.push('case below minDelta');
    if (entry.partial === true) reasons.push('case partial');
    if (Array.isArray(entry.errors) && entry.errors.length > 0) reasons.push('case errored');
    if (!entry.evidence || !existsSync(join(root, entry.evidence))) reasons.push('missing evidence');
  }
  if (report.review?.[skill]?.verdict !== 'pass') reasons.push('review not passed');
  return reasons;
}

export function checkFreshness(report, now, maxAttestationAgeDays) {
  if (!report.generatedAt) return ['attestation too old'];
  const ageDays = (now.getTime() - new Date(report.generatedAt).getTime()) / 86_400_000;
  return Number.isFinite(ageDays) && ageDays <= maxAttestationAgeDays ? [] : ['attestation too old'];
}

/** B8: a diff that touches skills/ must also bump plugin.json's version and add a CHANGELOG line. */
export function checkReleaseDiscipline(root, base, head, changedPaths) {
  if (!changedPaths.some(p => p.startsWith('skills/'))) return [];
  const reasons = [];
  const baseVersion = readPluginVersion(root, base);
  const headVersion = readPluginVersion(root, head);
  if (baseVersion !== null && baseVersion === headVersion) reasons.push('version not bumped');
  if (!changelogGainedLine(root, base, head)) reasons.push('changelog not updated');
  return reasons;
}

function readPluginVersion(root, ref) {
  const text = showFileAtRef(root, ref, '.claude-plugin/plugin.json');
  if (text === null) return null;
  try { return JSON.parse(text).version ?? null; } catch { return null; }
}

/** True once an added line (in the new-file sense: not a `-` removed line) with real content sits
 * under a `## Unreleased` or `## <version>` heading in the CHANGELOG.md diff. */
function changelogGainedLine(root, base, head) {
  const diff = diffFile(root, base, head, 'CHANGELOG.md');
  let heading = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ')) continue;
    if (line.startsWith('-')) continue;
    const content = line.length ? line.slice(1) : '';
    const h = content.match(/^##\s+(\S.*)$/);
    if (h) { heading = h[1].trim(); continue; }
    const underReleaseHeading = heading === 'Unreleased' || /^\d+\.\d+\.\d+/.test(heading ?? '');
    if (line.startsWith('+') && underReleaseHeading && content.trim().length > 0) return true;
  }
  return false;
}
