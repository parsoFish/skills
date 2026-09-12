// Small git helpers shared by attest.mjs. Every function fails fast (throws) on a git error it did
// not itself expect, so a broken repo surfaces as a stack trace, not a silently wrong digest.
import { spawnSync } from 'node:child_process';

function run(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
}

/** git ls-files -s <pathspecs> → [{mode, blob, path}], throws on a git error. */
export function lsFiles(root, pathspecs) {
  const r = run(root, ['ls-files', '-s', '--', ...pathspecs]);
  if (r.status !== 0) throw new Error(`git ls-files -s -- ${pathspecs.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.split('\n').filter(Boolean).map(line => {
    const m = line.match(/^(\d+) ([0-9a-f]{7,64}) (\d+)\t(.+)$/);
    if (!m) throw new Error(`unparseable git ls-files line: ${line}`);
    return { mode: m[1], blob: m[2], path: m[4] };
  });
}

/** git status --porcelain <pathspecs> → array of paths with a status, renames resolved to the new
 * path. Uses --untracked-files=all so a brand-new directory is listed file by file rather than
 * collapsed to its own path — the exclusion predicates that read this output match file paths, and a
 * scoped pathspec like this one never touches enough files for the usual -uall cost to matter. */
export function statusPorcelain(root, pathspecs) {
  const r = run(root, ['status', '--porcelain', '--untracked-files=all', '--', ...pathspecs]);
  if (r.status !== 0) throw new Error(`git status --porcelain -- ${pathspecs.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.split('\n').filter(Boolean).map(line => {
    const rest = line.slice(3);
    const arrow = rest.indexOf(' -> ');
    return arrow >= 0 ? rest.slice(arrow + 4) : rest;
  });
}

/** git diff --name-only base...head → changed paths. Throws when the ref cannot be resolved (a
 * missing/misspelled base must surface, not read as "nothing changed"). */
export function diffNameOnly(root, base, head = 'HEAD') {
  const r = run(root, ['diff', '--name-only', `${base}...${head}`]);
  if (r.status !== 0) throw new Error(`git diff --name-only ${base}...${head} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.split('\n').filter(Boolean);
}

/** True when `commit` is an object this checkout has. After a squash merge the branch commits an
 * attestation named are gone from every clone, so "unknown here" must not read as "not an ancestor". */
export function commitExists(root, commit) {
  if (!commit) return false;
  return run(root, ['cat-file', '-e', `${commit}^{commit}`]).status === 0;
}

/** True only when `commit` resolves and is an ancestor of `head`; any git error reads as "not an ancestor". */
export function isAncestor(root, commit, head = 'HEAD') {
  if (!commit) return false;
  return run(root, ['merge-base', '--is-ancestor', commit, head]).status === 0;
}

/** Contents of `path` as it existed at `ref`, or null when the ref or path does not resolve. */
export function showFileAtRef(root, ref, path) {
  const r = run(root, ['show', `${ref}:${path}`]);
  return r.status === 0 ? r.stdout : null;
}

/** git diff between base and head for one path, full context so every hunk carries its `## ` headings. */
export function diffFile(root, base, head, path) {
  const r = run(root, ['diff', '--unified=100000', `${base}...${head}`, '--', path]);
  if (r.status !== 0) throw new Error(`git diff -- ${path} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/** Pure: which skill (skills/<name>/... or evals/<name>/...) each changed path belongs to, deduplicated and sorted. */
/** Skill names touched by these paths, restricted to directories that exist under skills/ so that
 * evals/attest, evals/results and friends never read as a skill named "attest". */
export function changedSkillNames(paths, knownSkills = null) {
  const out = new Set();
  for (const p of paths) { const m = p.match(/^(?:skills|evals)\/([^/]+)\//); if (m && (knownSkills === null || knownSkills.includes(m[1]))) out.add(m[1]); }
  return [...out].sort();
}
