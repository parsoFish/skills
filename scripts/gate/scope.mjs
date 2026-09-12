// Git-derived change scope for the skills gate: which base ref to diff against, and which skills or
// harness files changed relative to it. Git plumbing here throws on any non-zero exit instead of
// swallowing it — a silent `git diff` failure is what let the gate no-op on every branch.
import { spawnSync } from 'node:child_process';

// The canonical empty-tree object: diffing against it makes every tracked path show up as added, so
// resolveBase can fall back to it when no real base ref is available (e.g. no upstream configured).
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// Harness = the gate's own plumbing and CI wiring. A change here must run the deterministic half even
// when no skill changed, and must invalidate any cached agentic pass (its digest covers this set).
const HARNESS_RE = /^(scripts\/|tests\/|lint\.config\.json|gate\.config\.json|package\.json|\.github\/workflows\/)/;

/** Strict git helper: throws (naming the command and stderr) on any non-zero exit. */
export function shStrict(argv, opts = {}) {
  const r = spawnSync('git', argv, { encoding: 'utf8', maxBuffer: 1 << 26, ...opts });
  if (r.error) throw new Error(`git ${argv.join(' ')} failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${argv.join(' ')} exited ${r.status}: ${(r.stderr ?? r.stdout ?? '').trim()}`);
  return r.stdout ?? '';
}

/** Whether `git rev-parse --verify <ref>^{commit}` resolves — false rather than thrown, so
 * resolveBase can try one candidate ref after another. */
export function refExists(root, ref) {
  const r = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' });
  return r.status === 0;
}

/** A git-verification port bound to `root`, for resolveBase / tests to use or stub. */
export function createGit(root) {
  return { verify: ref => refExists(root, ref) };
}

/** Pure: pick the first ref that resolves — the caller's --base, then @{upstream}, then origin/main,
 * then main — falling back to the empty-tree sentinel (so everything counts as changed) when none do.
 * `git.verify(ref)` is injected so this is testable without a real repo. */
export function resolveBase(argBase, git) {
  for (const ref of [argBase, '@{upstream}', 'origin/main', 'main'].filter(Boolean)) {
    if (git.verify(ref)) return ref;
  }
  return EMPTY_TREE_SHA;
}

/** Every path changed relative to `base`: committed diff, uncommitted diff against HEAD, and
 * untracked files. Two-dot diff against the empty-tree sentinel (it is not a commit, so the
 * merge-base semantics of three-dot diff do not apply to it); three-dot (merge-base) diff otherwise,
 * so a branch's own commits show up without unrelated upstream churn. */
export function changedPaths(root, base) {
  const diffArgs = base === EMPTY_TREE_SHA ? ['diff', '--name-only', base, 'HEAD'] : ['diff', '--name-only', `${base}...HEAD`];
  const committed = shStrict(diffArgs, { cwd: root });
  const uncommitted = shStrict(['diff', '--name-only', 'HEAD'], { cwd: root });
  const untracked = shStrict(['ls-files', '--others', '--exclude-standard'], { cwd: root });
  return [...committed.split('\n'), ...uncommitted.split('\n'), ...untracked.split('\n')].map(s => s.trim()).filter(Boolean);
}

/** Pure: which skills do these changed paths touch? `knownSkills` (the directories under skills/)
 * keeps evals/ housekeeping — evals/attest, evals/results, evals/REPORT.md — from reading as a skill. */
export function changedSkills(paths, knownSkills = null) {
  const out = new Set();
  for (const p of paths) {
    const m = p.match(/^(?:skills|evals)\/([^/]+)\//);
    if (m && (knownSkills === null || knownSkills.includes(m[1]))) out.add(m[1]);
  }
  return [...out].sort();
}

/** Pure: split changed paths into { skills, harness }. */
export function changedScope(paths, knownSkills = null) {
  return { skills: changedSkills(paths, knownSkills), harness: paths.some(p => HARNESS_RE.test(p)) };
}
