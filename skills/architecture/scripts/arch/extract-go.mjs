// Offline, dependency-cruiser-shaped import graph for Go: {modules:[{source, dependencies:[{module,
// resolved}]}]} from *.go files, so fold.mjs can group by directory the same way it already does
// for JS/TS. The module path comes from go.mod; an import of "<module>/x/y" resolves to a
// representative file inside package dir x/y (its first .go file, alphabetically, tests excluded)
// rather than the whole directory, matching extract-imports.mjs's per-file convention. Standard
// library and third-party imports are reported unresolved. Deterministic, no `go list`, no lib.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { walkFiles } from './walk.mjs';

const BLOCK_IMPORT_RE = /import\s*\(([\s\S]*?)\)/g;
const SINGLE_IMPORT_RE = /^\s*import\s+(?:[A-Za-z0-9_.]+\s+)?"([^"]+)"/gm;

/** Import path specifiers found in a Go source file's text: grouped `import (...)` blocks and single `import "..."` lines. */
export function specifiers(text) {
  const out = [];
  for (const m of text.matchAll(BLOCK_IMPORT_RE)) {
    for (const line of m[1].split(/\r?\n/)) {
      const clean = line.replace(/\/\/.*$/, '').trim();
      if (!clean) continue;
      const q = clean.match(/"([^"]+)"/);
      if (q) out.push(q[1]);
    }
  }
  for (const m of text.matchAll(SINGLE_IMPORT_RE)) out.push(m[1]);
  return out;
}

function modulePath(root) {
  const p = join(root, 'go.mod');
  if (!existsSync(p)) return null;
  const m = readFileSync(p, 'utf8').match(/^module\s+(\S+)/m);
  return m ? m[1] : null;
}

// Package dir (posix, "." for repo root) for a repo-relative *.go file path.
function packageDir(rel) {
  const d = dirname(rel);
  return d === '.' ? '.' : d;
}

/** The package dir's representative file: its first non-test .go file, alphabetically. */
function representativeFile(filesByDir, dir) {
  const files = filesByDir.get(dir);
  if (!files || !files.length) return null;
  return dir === '.' ? files[0] : `${dir}/${files[0]}`;
}

export function extractGo(root, { ignore = [] } = {}) {
  const mod = modulePath(root);
  const goFiles = walkFiles(root, { ignore, exts: ['.go'] });

  const filesByDir = new Map();
  for (const rel of goFiles) {
    const dir = packageDir(rel);
    const base = dir === '.' ? rel : rel.slice(dir.length + 1);
    if (base.endsWith('_test.go')) continue;
    if (!filesByDir.has(dir)) filesByDir.set(dir, []);
    filesByDir.get(dir).push(base);
  }
  for (const files of filesByDir.values()) files.sort();

  const modules = goFiles.map(rel => {
    let text; try { text = readFileSync(join(root, rel), 'utf8'); } catch { return { source: rel, dependencies: [] }; }
    const deps = new Map();
    for (const spec of specifiers(text)) {
      if (deps.has(spec)) continue;
      if (mod && (spec === mod || spec.startsWith(mod + '/'))) {
        const sub = spec === mod ? '.' : spec.slice(mod.length + 1);
        const resolved = representativeFile(filesByDir, sub);
        deps.set(spec, resolved ? { module: spec, resolved } : { module: spec, resolved: null, couldNotResolve: true });
      } else {
        deps.set(spec, { module: spec, resolved: null, couldNotResolve: true });
      }
    }
    return { source: rel, dependencies: [...deps.values()].sort((a, b) => a.module.localeCompare(b.module)) };
  });

  return { modules, summary: { totalCruised: modules.length, engine: 'builtin-go' } };
}
