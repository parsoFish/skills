// Built-in, offline import scanner for JS/TS: produces the dependency-cruiser JSON shape
// ({ modules: [{ source, dependencies: [{ resolved }] }] }) so fold.mjs can run without npx or network.
// Resolves relative imports only (./ ../) with extension and index guessing; bare specifiers (packages) are
// reported as unresolved and ignored by the fold. Deterministic: sorted modules and dependencies.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { walkFiles } from './walk.mjs';

const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx'];
const IMPORT_RE = /(?:^|[^\w$])(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?['"]([^'"]+)['"]|(?:^|[^\w$])(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function resolveRelative(fromFile, spec, root) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, ...EXTS.map(e => base + e), ...EXTS.map(e => join(base, 'index' + e))];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return relative(root, c).split('\\').join('/');
  }
  // TS convention: import './x.js' for a ./x.ts source
  const m = base.match(/^(.*)\.(m|c)?js$/);
  if (m) for (const e of ['.ts', '.tsx', '.mts', '.cts']) { const c = m[1] + e; if (existsSync(c)) return relative(root, c).split('\\').join('/'); }
  return null;
}

export function specifiers(text) {
  const out = [];
  for (const m of text.matchAll(IMPORT_RE)) out.push(m[1] ?? m[2]);
  return out;
}

export function extractImports(root, { ignore = [], include = null } = {}) {
  const inc = include ? new RegExp(include) : null;
  const files = walkFiles(root, { ignore, exts: EXTS }).filter(f => !inc || inc.test(f));
  const modules = files.map(rel => {
    const abs = join(root, rel);
    let text; try { text = readFileSync(abs, 'utf8'); } catch { return { source: rel, dependencies: [] }; }
    const deps = new Map();
    for (const spec of specifiers(text)) {
      if (!spec.startsWith('.')) { deps.set(spec, { module: spec, resolved: null, couldNotResolve: true, dependencyTypes: ['npm'] }); continue; }
      const r = resolveRelative(abs, spec, root);
      deps.set(spec, r ? { module: spec, resolved: r, dependencyTypes: ['local'] } : { module: spec, resolved: null, couldNotResolve: true, dependencyTypes: ['local'] });
    }
    return { source: rel, dependencies: [...deps.values()].sort((a, b) => a.module.localeCompare(b.module)) };
  });
  return { modules, summary: { totalCruised: modules.length, engine: 'builtin-imports' } };
}
