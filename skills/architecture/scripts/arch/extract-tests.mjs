// Extract the test inventory: counts per top-level dir plus @seam/@layer tag adoption.
// Deterministic, read-only, no lib.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
const TEST_FILE = /\.(test|spec)\.[^/]+$/;
const TEST_DIR = /(^|\/)(tests?|__tests__)(\/|$)/;
const LAYERS = ['unit', 'contract', 'journey', 'ground'];

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

function isTestFile(rel) { return TEST_FILE.test(rel) || TEST_DIR.test(rel); }

// First two directory segments, e.g. "packages/flows/tests/a.test.ts" -> "packages/flows".
function topDir(rel) {
  const dirSegs = rel.split('/').slice(0, -1);
  return dirSegs.length ? dirSegs.slice(0, 2).join('/') : '.';
}

/** Test inventory: file counts per top-level dir, plus @seam/@layer tag coverage. */
export function extractTests(root) {
  const relFiles = collectFiles(root, 20000).map(f => toPosix(relative(root, f))).filter(isTestFile);
  const total = relFiles.length;

  const dirCount = new Map();
  for (const rel of relFiles) { const d = topDir(rel); dirCount.set(d, (dirCount.get(d) ?? 0) + 1); }
  const byDir = [...dirCount.entries()].map(([dir, count]) => ({ dir, count })).sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));

  const seamMap = new Map();
  for (const rel of relFiles) {
    let text; try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const sm = line.match(/@seam\s+([A-Za-z0-9_.-]+)/);
      if (!sm) continue;
      const seam = sm[1];
      if (!seamMap.has(seam)) seamMap.set(seam, { unit: 0, contract: 0, journey: 0, ground: 0 });
      const lm = line.match(/@layer\s+(unit|contract|journey|ground)/);
      if (lm) seamMap.get(seam)[lm[1]] += 1;
    }
  }
  const seams = [...seamMap.entries()].map(([seam, layers]) => ({ seam, layers })).sort((a, b) => a.seam.localeCompare(b.seam));

  return { total, byDir, tagged: { seams, count: seams.length }, taggingAdopted: seams.length > 0 };
}

export { LAYERS };
