// Extract the HTTP API surface: an openapi document if present, else /api/... string literals
// grepped from production source. Deterministic, read-only, no lib.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, join, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
const TEST_PATH = /(^|\/)(tests?|__tests__)(\/|$)|\.test\./;
const LITERAL_RE = /['"](\/api\/[A-Za-z0-9/_:{}.-]+)['"]/g;

function toPosix(p) { return p.split(sep).join('/'); }

function collectFiles(root, cap) {
  const out = [];
  function walk(dir) {
    if (out.length >= cap) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= cap) return;
      if (SKIP_DIRS.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p); else out.push(p);
    }
  }
  walk(root);
  return out;
}

function findOpenApi(root) {
  for (const dir of [root, join(root, 'docs'), join(root, 'api')]) {
    for (const ext of ['yaml', 'yml', 'json']) {
      const p = join(dir, `openapi.${ext}`);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// "packages/library" from "packages/library/src/routes/users.ts" — first two dir segments.
function topDir(rel) {
  const dirSegs = rel.split('/').slice(0, -1);
  return dirSegs.length ? dirSegs.slice(0, 2).join('/') : '.';
}

/** OpenAPI doc if present at root/docs/api, else grouped /api/... literals from production code. */
export function extractApi(root) {
  const openapi = findOpenApi(root);
  if (openapi) {
    const file = toPosix(relative(root, openapi));
    if (openapi.endsWith('.json')) {
      const parsed = JSON.parse(readFileSync(openapi, 'utf8'));
      return { source: 'openapi', file, pathCount: Object.keys(parsed.paths ?? {}).length };
    }
    const pathCount = readFileSync(openapi, 'utf8').split(/\r?\n/).filter(l => /^ {2}\//.test(l)).length;
    return { source: 'openapi', file, pathCount };
  }

  const notes = [];
  const files = collectFiles(root, 20000).filter(f => /\.(ts|tsx|js)$/.test(f) && !TEST_PATH.test(toPosix(relative(root, f))));
  if (!files.length) notes.push('no production .ts/.tsx/.js files found');

  const pathSet = new Set();
  const byOwnerCount = new Map();
  for (const f of files) {
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    let m, hit = false;
    while ((m = LITERAL_RE.exec(text))) { pathSet.add(m[1]); hit = true; }
    if (hit) { const dir = topDir(toPosix(relative(root, f))); byOwnerCount.set(dir, (byOwnerCount.get(dir) ?? 0) + 1); }
  }

  const paths = [...pathSet].sort();
  const groupCount = new Map();
  for (const p of paths) { const g = p.split('/')[2] ?? ''; groupCount.set(g, (groupCount.get(g) ?? 0) + 1); }
  const groups = [...groupCount.entries()].map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));
  const byOwner = [...byOwnerCount.entries()].map(([dir, count]) => ({ dir, count })).sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));

  return { source: 'literals', paths, groups, byOwner, notes };
}
