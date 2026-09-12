// Extract UI anchors: routes (Next app/pages router, React Router, Express) and data-* attribute
// names. Deterministic, read-only, no lib.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
const TEST_PATH = /(^|\/)(tests?|__tests__)(\/|$)|\.test\./;

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

function dynamicSeg(s) { const m = s.match(/^\[(\.\.\.)?([^\]]+)\]$/); return m ? ':' + m[2] : s; }

// "apps/studio/app/blog/[slug]/page.tsx" -> "/blog/:slug" (segments after the last "app" dir).
function nextAppRoute(rel) {
  const segs = rel.split('/');
  const idx = segs.lastIndexOf('app');
  if (idx === -1) return null;
  const routeSegs = segs.slice(idx + 1, -1).filter(s => !/^\(.*\)$/.test(s)).map(dynamicSeg);
  return '/' + routeSegs.join('/');
}

// "apps/studio/pages/blog/[slug].tsx" -> "/blog/:slug"; index files drop their own segment.
function pagesRoute(rel) {
  const segs = rel.split('/');
  const idx = segs.lastIndexOf('pages');
  if (idx === -1 || segs[idx + 1] === 'api') return null;
  let routeSegs = segs.slice(idx + 1).map((s, i, arr) => i === arr.length - 1 ? s.replace(/\.(tsx|jsx|ts|js)$/, '') : s);
  if (routeSegs[routeSegs.length - 1] === 'index') routeSegs = routeSegs.slice(0, -1);
  if (routeSegs[0]?.startsWith('_')) return null;
  return '/' + routeSegs.map(dynamicSeg).join('/');
}

function literalRoutes(text) {
  const routes = [];
  for (const m of text.matchAll(/<Route\b[^>]*\spath=["']([^"']+)["']/gs)) routes.push(m[1]);
  for (const m of text.matchAll(/\bapp\.(?:get|post|put|delete|patch|use)\(\s*['"]([^'"]+)['"]/g)) routes.push(m[1]);
  return routes;
}

/** UI routes (Next app/pages router, React Router, Express) and data-* attribute usage. */
export function extractUi(root) {
  const files = collectFiles(root, 20000).map(f => ({ abs: f, rel: toPosix(relative(root, f)) })).filter(f => !TEST_PATH.test(f.rel));

  const routeSet = new Set();
  const routes = [];
  const addRoute = (route, file) => { if (!route) return; const k = `${route}||${file}`; if (routeSet.has(k)) return; routeSet.add(k); routes.push({ route, file }); };

  for (const f of files) {
    if (f.rel.endsWith('/page.tsx') || f.rel === 'app/page.tsx') addRoute(nextAppRoute(f.rel), f.rel);
    if (/\/pages\//.test(`/${f.rel}`) && /\.(tsx|jsx|ts|js)$/.test(f.rel)) addRoute(pagesRoute(f.rel), f.rel);
    if (/\.(tsx|jsx|ts|js)$/.test(f.rel)) {
      let text; try { text = readFileSync(f.abs, 'utf8'); } catch { continue; }
      for (const route of literalRoutes(text)) addRoute(route, f.rel);
    }
  }
  routes.sort((a, b) => a.route.localeCompare(b.route) || a.file.localeCompare(b.file));

  const attrNames = new Set();
  for (const f of files.filter(x => /\.(tsx|jsx|html)$/.test(x.rel))) {
    let text; try { text = readFileSync(f.abs, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/data-[a-z-]+/g)) attrNames.add(m[0]);
  }
  const sortedNames = [...attrNames].sort();
  return { routes, dataAttributes: { count: sortedNames.length, names: sortedNames.slice(0, 50) } };
}
