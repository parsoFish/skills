// Extract direct runtime dependencies across npm workspaces, go.mod, and terraform providers,
// with production import-site evidence. Deterministic, read-only, no lib beyond node:fs.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
const CODE_EXT = /\.(ts|tsx|js|mjs)$/;
const TEST_PATH = /(^|\/)(tests?|__tests__)(\/|$)|\.test\./;
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'go.sum'];

function toPosix(p) { return p.split(sep).join('/'); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function walk(dir, out, cap) {
  if (out.length >= cap) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= cap) break;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, cap); else out.push(p);
  }
  return out;
}

// Tiny glob for workspaces entries: only "*" as a whole path segment is supported.
function resolveWorkspaceDirs(root, patterns) {
  const dirs = [];
  for (const pattern of patterns ?? []) {
    let bases = [root];
    for (const seg of pattern.split('/')) {
      const next = [];
      for (const base of bases) {
        if (seg === '*') {
          if (!existsSync(base)) continue;
          for (const name of readdirSync(base)) { const p = join(base, name); if (statSync(p).isDirectory()) next.push(p); }
        } else { const p = join(base, seg); if (existsSync(p)) next.push(p); }
      }
      bases = next;
    }
    dirs.push(...bases);
  }
  return dirs.filter(d => existsSync(join(d, 'package.json')));
}

function parseGoMod(text) {
  const deps = [];
  const block = text.match(/require\s*\(([\s\S]*?)\)/);
  if (block) for (const line of block[1].split(/\r?\n/)) { const m = line.trim().match(/^(\S+)\s+(\S+)/); if (m) deps.push(m); }
  for (const line of text.split(/\r?\n/)) { const m = line.match(/^require\s+(\S+)\s+(\S+)/); if (m) deps.push([null, m[1], m[2]]); }
  return deps.map(m => m.length === 2 ? { name: m[0], version: m[1] } : { name: m[1], version: m[2] });
}

// Balanced-brace scan: a naive lazy regex stops at the first nested "}", not the block's own close.
function braceBlockAfter(text, marker) {
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const start = text.indexOf('{', idx);
  if (start === -1) return null;
  let depth = 0, i = start;
  for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) break; }
  return text.slice(start + 1, i);
}

function parseTfProviders(text) {
  const deps = [];
  const body = braceBlockAfter(text, 'required_providers');
  if (!body) return deps;
  const re = /([A-Za-z0-9_-]+)\s*=\s*{([^}]*)}/g;
  let m;
  while ((m = re.exec(body))) { const v = m[2].match(/version\s*=\s*"([^"]+)"/); deps.push({ name: m[1], version: v ? v[1] : null }); }
  return deps;
}

function findImportSites(root, files, name) {
  const re = new RegExp(`from\\s+['"]${escapeRe(name)}(?:/[^'"]*)?['"]|require\\(\\s*['"]${escapeRe(name)}(?:/[^'"]*)?['"]\\s*\\)`);
  const sites = [];
  for (const f of files) {
    if (sites.length >= 5) break;
    if (!CODE_EXT.test(f)) continue;
    const rel = toPosix(relative(root, f));
    if (TEST_PATH.test(rel)) continue;
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    if (re.test(text)) sites.push(rel);
  }
  return sites.sort();
}

/** Direct runtime deps from root+workspace package.json, go.mod, *.tf required_providers. */
export function extractDeps(root) {
  const notes = [];
  const declarers = []; // { name, deps: {name: version} }
  const rootPkgPath = join(root, 'package.json');
  if (existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
    declarers.push({ name: rootPkg.name ?? 'root', deps: rootPkg.dependencies ?? {} });
    const wsField = rootPkg.workspaces;
    const patterns = Array.isArray(wsField) ? wsField : Array.isArray(wsField?.packages) ? wsField.packages : [];
    for (const dir of resolveWorkspaceDirs(root, patterns)) {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      declarers.push({ name: pkg.name ?? toPosix(relative(root, dir)), deps: pkg.dependencies ?? {} });
    }
  } else notes.push('no root package.json');

  const goModPath = join(root, 'go.mod');
  if (existsSync(goModPath)) {
    const text = readFileSync(goModPath, 'utf8');
    const moduleName = (text.match(/^module\s+(\S+)/m) ?? [, 'go.mod'])[1];
    declarers.push({ name: moduleName, deps: Object.fromEntries(parseGoMod(text).map(d => [d.name, d.version])) });
  }

  const allFiles = existsSync(root) ? walk(root, [], 20000) : [];
  for (const f of allFiles.filter(p => p.endsWith('.tf'))) {
    const providers = parseTfProviders(readFileSync(f, 'utf8'));
    if (providers.length) declarers.push({ name: toPosix(relative(root, dirname(f))) || '.', deps: Object.fromEntries(providers.map(d => [d.name, d.version])) });
  }

  const depMap = new Map();
  for (const d of declarers) for (const [name, version] of Object.entries(d.deps)) {
    if (!depMap.has(name)) depMap.set(name, { version, usedBy: new Set() });
    depMap.get(name).usedBy.add(d.name);
  }

  const deps = [...depMap.entries()].map(([name, info]) => {
    const importSites = findImportSites(root, allFiles, name);
    return { name, version: info.version, usedBy: [...info.usedBy].sort(), importSites, why: importSites.length ? `imported by ${importSites[0]}` : null, unused: importSites.length === 0 };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const lockfile = LOCKFILES.find(f => existsSync(join(root, f))) ?? null;
  return { deps, lockfile, notes };
}
