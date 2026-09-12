// Extract environment variable reads from production source (JS/TS/Go/Python).
// Deterministic, read-only, no lib.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
const CODE_EXT = /\.(ts|tsx|js|mjs|go|py)$/;
const TEST_PATH = /(^|\/)(tests?|__tests__)(\/|$)|\.test\./;
const SECRET_RE = /TOKEN|SECRET|KEY|PASSWORD|AUTH/i;

const PATTERN_SOURCES = [
  'process\\.env\\.([A-Z_][A-Z0-9_]*)',
  'os\\.Getenv\\(\\s*"([A-Z_][A-Z0-9_]*)"\\s*\\)',
  "os\\.environ\\[\\s*['\"]([A-Z_][A-Z0-9_]*)['\"]\\s*\\]",
  "os\\.environ\\.get\\(\\s*['\"]([A-Z_][A-Z0-9_]*)['\"]",
  '(?<![.\\w])env\\.([A-Z_][A-Z0-9_]*)',
];

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

/** Env vars read in production source, with up to 3 file:line sites each and secret-like names flagged. */
export function extractEnv(root) {
  const files = collectFiles(root, 20000).filter(f => CODE_EXT.test(f) && !TEST_PATH.test(toPosix(relative(root, f))));
  const vars = new Map();
  for (const f of files) {
    const rel = toPosix(relative(root, f));
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const src of PATTERN_SOURCES) {
        const re = new RegExp(src, 'g');
        let m;
        while ((m = re.exec(lines[i]))) {
          const name = m[1];
          if (!vars.has(name)) vars.set(name, { count: 0, sites: [] });
          const v = vars.get(name);
          v.count += 1;
          if (v.sites.length < 3) v.sites.push(`${rel}:${i + 1}`);
        }
      }
    }
  }
  const varsArr = [...vars.entries()].map(([name, v]) => ({ name, count: v.count, sites: v.sites })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const secretLike = varsArr.map(v => v.name).filter(n => SECRET_RE.test(n)).sort();
  return { vars: varsArr, secretLike };
}
