// Shared directory walker for the arch extractors. Deterministic, read-only, no lib.
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo', '.cache', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv'];

export const isTestPath = relPath => /(^|\/)(tests?|__tests__|test-fixtures|fixtures|stories)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath);

const toPosix = p => p.split(sep).join('/');

/**
 * Sorted POSIX-relative file paths under root, skipping any directory whose NAME is in
 * DEFAULT_IGNORE ∪ ignore, or whose path RELATIVE TO root equals an ignore entry.
 * `exts` optionally filters to a set of file extensions (e.g. ['.ts', '.tsx']).
 * Throws if `cap` files would be exceeded — never silently truncates.
 */
export function walkFiles(root, { ignore = [], cap = 200000, exts = null } = {}) {
  // Built-in names are skipped anywhere in the tree (by directory name); custom `ignore`
  // entries are skipped only where their full relative path matches exactly — a bare name
  // like "projects" ignores <root>/projects but not <root>/apps/projects.
  const ignoreNames = new Set(DEFAULT_IGNORE);
  const ignorePaths = new Set(ignore);
  const extSet = exts ? new Set(exts) : null;
  const out = [];

  function extnameOf(name) {
    const i = name.lastIndexOf('.');
    return i <= 0 ? '' : name.slice(i);
  }

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = toPosix(relative(root, abs));
      if (e.isDirectory()) {
        if (ignoreNames.has(e.name) || ignorePaths.has(rel)) continue;
        walk(abs);
        continue;
      }
      if (extSet && !extSet.has(extnameOf(e.name))) continue;
      if (out.length >= cap) throw new Error(`walkFiles: cap of ${cap} files exceeded under ${root}`);
      out.push(rel);
    }
  }

  walk(root);
  return out.sort();
}
