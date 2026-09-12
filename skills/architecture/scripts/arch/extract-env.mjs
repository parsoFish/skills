// Extract environment variable reads from production source (JS/TS/Go/Python).
// Deterministic, read-only, no lib.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles, isTestPath } from './walk.mjs';

const SECRET_RE = /TOKEN|SECRET|KEY|PASSWORD|AUTH/i;
const CODE_EXTS = ['.ts', '.tsx', '.js', '.mjs', '.go', '.py'];

const PATTERN_SOURCES = [
  'process\\.env\\.([A-Z_][A-Z0-9_]*)',
  'os\\.Getenv\\(\\s*"([A-Z_][A-Z0-9_]*)"\\s*\\)',
  "os\\.environ\\[\\s*['\"]([A-Z_][A-Z0-9_]*)['\"]\\s*\\]",
  "os\\.environ\\.get\\(\\s*['\"]([A-Z_][A-Z0-9_]*)['\"]",
  '(?<![.\\w])env\\.([A-Z_][A-Z0-9_]*)',
];

/** Env vars read in production source, with up to 3 file:line sites each and secret-like names flagged. */
export function extractEnv(root, opts = {}) {
  const { ignore = [] } = opts;
  const files = walkFiles(root, { ignore, exts: CODE_EXTS }).filter(f => !isTestPath(f));
  const vars = new Map();
  for (const rel of files) {
    let text; try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
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
