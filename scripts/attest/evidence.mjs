// Copies a `claude plugin eval --json` result into the tracked evidence a case's attestation points
// at. `tracePath` is stripped (it names a throwaway sandbox dir on the machine that ran the eval,
// useless and unreproducible to a reader); so is `suite.root`/`suite.plugins` (the absolute repo path
// and the personally-named local plugin the CLI recorded for *this* run), and — as a generic safety
// net for any other field that might quote an absolute path — every remaining string gets the current
// user's home directory rewritten to `<root>`. Every grader `passed` + `explanation` for both arms
// stays untouched, so forging a pass means fabricating a plausible transcript, not flipping one
// boolean. This is what keeps evals/attest/*.json passing the forbidden-terms lint that already scans
// evals/**: the raw `claude plugin eval` output otherwise bakes the operator's home-directory path and
// personal plugin name into evidence meant to be portable and lint-clean.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/** Returns a new value with every `tracePath` key removed at any depth. Never mutates its input. */
export function stripTracePath(value) {
  if (Array.isArray(value)) return value.map(stripTracePath);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) { if (k !== 'tracePath') out[k] = stripTracePath(v); }
    return out;
  }
  return value;
}

/** Drops `suite.root` (the absolute repo path) and reduces `suite.plugins` to its length — a count of
 * how many plugins were loaded, with no path or personally-named package inside it. Everything else in
 * `suite` (ablation, model overrides, threshold, concurrency) is evidentiary run configuration and stays. */
export function redactSuiteIdentity(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  if (!value.suite || typeof value.suite !== 'object') return value;
  const { root, plugins, ...restSuite } = value.suite;
  return { ...value, suite: { ...restSuite, ...(plugins !== undefined ? { plugins: Array.isArray(plugins) ? plugins.length : plugins } : {}) } };
}

/** Returns a new value with every string that contains `home` rewritten so that prefix reads as
 * `<root>` — a generic net for an absolute path leaking through a field this module does not know by
 * name (a judge explanation quoting a file path, for instance), on top of the specific redactions
 * above. A no-op when `home` is falsy. */
export function redactHomePaths(value, home = homedir()) {
  if (!home) return value;
  if (Array.isArray(value)) return value.map(v => redactHomePaths(v, home));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactHomePaths(v, home);
    return out;
  }
  return typeof value === 'string' && value.includes(home) ? value.split(home).join('<root>') : value;
}

/** Copies `fromJsonPath` to evals/attest/<caseName>.json with tracePath, suite identity fields and
 * any remaining home-directory path stripped; returns that path relative to `root`. Fails fast when
 * the source evidence is missing or not valid JSON — a silently skipped copy would leave an
 * attestation that claims coverage it does not have. */
export function copyEvidence(root, caseName, fromJsonPath) {
  if (!existsSync(fromJsonPath)) throw new Error(`copyEvidence: source evidence missing: ${fromJsonPath}`);
  let parsed;
  try { parsed = JSON.parse(readFileSync(fromJsonPath, 'utf8')); }
  catch (err) { throw new Error(`copyEvidence: ${fromJsonPath} is not valid JSON: ${err.message}`); }
  const cleaned = redactHomePaths(redactSuiteIdentity(stripTracePath(parsed)));
  const relPath = join('evals', 'attest', `${caseName}.json`);
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, JSON.stringify(cleaned, null, 1) + '\n');
  return relPath.split('\\').join('/');
}
