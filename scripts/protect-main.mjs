#!/usr/bin/env node
// Idempotently protect `main` behind the checks that can actually go green, plus the repo merge
// settings that keep history linear. Never runs unattended: `--dry-run` and `--check` touch
// nothing; only a bare invocation writes to GitHub.
// Usage:
//   node scripts/protect-main.mjs             apply the desired protection + repo settings
//   node scripts/protect-main.mjs --dry-run   print the payload, change nothing
//   node scripts/protect-main.mjs --check     GET current protection, diff against desired, exit 1 on mismatch
import { execFileSync } from 'node:child_process';

/**
 * Pure: the exact branch-protection payload this repo requires for `main`. `restrictions` is a
 * required top-level field of the GitHub API even when null (no push restrictions beyond the
 * checks below); it is not skipped just because the brief for this script didn't name it.
 */
export function protectionPayload({ contexts = ['deterministic', 'attested'] } = {}) {
  return {
    required_status_checks: { strict: true, contexts: [...contexts] },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
    required_linear_history: true,
    required_conversation_resolution: true,
  };
}

/** Pure: "owner/repo" out of a GitHub remote URL (https or ssh, with or without .git). */
export function parseOwnerRepo(remoteUrl) {
  const m = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl ?? '');
  if (!m) throw new Error(`protect-main: cannot parse owner/repo from remote "${remoteUrl}"`);
  return { owner: m[1], repo: m[2] };
}

/**
 * Pure: GET .../protection wraps most flags as `{enabled: bool}`, while PUT takes bare booleans.
 * Normalize a GET response into the same flat shape as `protectionPayload()`'s output so the two
 * can be diffed field for field.
 */
export function normalizeCurrentProtection(current) {
  const enabled = v => (v && typeof v === 'object' ? v.enabled === true : v === true);
  return {
    required_status_checks: {
      strict: current?.required_status_checks?.strict === true,
      contexts: [...(current?.required_status_checks?.contexts ?? [])].sort(),
    },
    enforce_admins: enabled(current?.enforce_admins),
    required_pull_request_reviews: current?.required_pull_request_reviews ?? null,
    restrictions: current?.restrictions ?? null,
    allow_force_pushes: enabled(current?.allow_force_pushes),
    allow_deletions: enabled(current?.allow_deletions),
    required_linear_history: enabled(current?.required_linear_history),
    required_conversation_resolution: enabled(current?.required_conversation_resolution),
  };
}

/**
 * Pure: human-readable mismatch lines between a live GET .../protection response and the desired
 * payload. Empty means they already match (the PUT would be a no-op — this is what makes apply
 * idempotent and what `--check` reports on in CI or by hand).
 */
export function diffProtection(current, desired) {
  const norm = normalizeCurrentProtection(current);
  const diffs = [];
  const cmp = (label, have, want) => { if (JSON.stringify(have) !== JSON.stringify(want)) diffs.push(`${label}: ${JSON.stringify(have)} -> ${JSON.stringify(want)}`); };
  cmp('required_status_checks.strict', norm.required_status_checks.strict, desired.required_status_checks.strict);
  cmp('required_status_checks.contexts', norm.required_status_checks.contexts, [...desired.required_status_checks.contexts].sort());
  cmp('enforce_admins', norm.enforce_admins, desired.enforce_admins);
  cmp('required_pull_request_reviews', norm.required_pull_request_reviews, desired.required_pull_request_reviews);
  cmp('allow_force_pushes', norm.allow_force_pushes, desired.allow_force_pushes);
  cmp('allow_deletions', norm.allow_deletions, desired.allow_deletions);
  cmp('required_linear_history', norm.required_linear_history, desired.required_linear_history);
  cmp('required_conversation_resolution', norm.required_conversation_resolution, desired.required_conversation_resolution);
  return diffs;
}

function currentRemote() { return execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim(); }

function main() {
  const args = process.argv.slice(2);
  const { owner, repo } = parseOwnerRepo(currentRemote());
  const desired = protectionPayload();

  if (args.includes('--dry-run')) {
    console.log(JSON.stringify(desired, null, 2));
    return;
  }

  if (args.includes('--check')) {
    let current;
    try {
      current = JSON.parse(execFileSync('gh', ['api', `repos/${owner}/${repo}/branches/main/protection`], { encoding: 'utf8' }));
    } catch (err) {
      console.error(`protect-main: GET repos/${owner}/${repo}/branches/main/protection failed — ${err.message}`);
      process.exitCode = 1;
      return;
    }
    const diffs = diffProtection(current, desired);
    if (diffs.length) {
      console.error(`protect-main: main does not match the desired protection:\n${diffs.map(d => `  - ${d}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log(`protect-main: ${owner}/${repo}#main matches the desired protection`);
    }
    return;
  }

  execFileSync('gh', ['api', '-X', 'PUT', `repos/${owner}/${repo}/branches/main/protection`, '--input', '-'], {
    input: JSON.stringify(desired), encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'],
  });
  execFileSync('gh', ['repo', 'edit', `${owner}/${repo}`, '--enable-squash-merge', '--enable-merge-commit=false', '--enable-rebase-merge=false', '--delete-branch-on-merge'], { stdio: 'inherit' });
  console.log(`protect-main: applied protection + repo settings to ${owner}/${repo}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
