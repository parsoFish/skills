// Extract extension points (registries) via a tiny glob engine over the repo tree.
// "*" matches within one path segment, "**" matches zero or more segments. No lib.
import { walkFiles } from './walk.mjs';

const DEFAULT_REGISTRIES = [
  { name: 'skill', glob: 'skills/*/SKILL.md' },
  { name: 'command', glob: '.claude/commands/*.md' },
  { name: 'plugin', glob: 'plugins/*' },
  { name: '_adapters', glob: '**/_adapters/*' },
  { name: 'adapters', glob: '**/adapters/*' },
];

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Glob patterns (e.g. "plugins/*") can name a directory itself, not just a file inside it, so
// every ancestor directory of each file walkFiles returns is added as its own candidate path.
function candidatePaths(root, opts) {
  const files = walkFiles(root, opts);
  const set = new Set();
  for (const f of files) {
    set.add(f);
    const segs = f.split('/');
    for (let i = 1; i < segs.length; i++) set.add(segs.slice(0, i).join('/'));
  }
  return [...set];
}

function segRegex(seg) { return new RegExp('^' + seg.split('*').map(escapeRe).join('[^/]*') + '$'); }

function matchSegs(pat, pi, path, si) {
  if (pi === pat.length) return si === path.length;
  if (pat[pi] === '**') return matchSegs(pat, pi + 1, path, si) || (si < path.length && matchSegs(pat, pi, path, si + 1));
  if (si >= path.length) return false;
  return segRegex(pat[pi]).test(path[si]) && matchSegs(pat, pi + 1, path, si + 1);
}

/** true if a repo-relative posix path matches a glob using "*" (segment) and "**" (any depth). */
export function globMatch(pattern, relPath) { return matchSegs(pattern.split('/'), 0, relPath.split('/'), 0); }

// The "installed" name is the path segment captured by the last wildcard-bearing pattern
// segment (counting from the end), e.g. "skills/*/SKILL.md" names the directory, while
// "plugins/*" and ".claude/commands/*.md" name the matched entry itself.
function installedNameFor(pattern, matchedRelPath) {
  const patSegs = pattern.split('/');
  const pathSegs = matchedRelPath.split('/');
  let fromEnd = -1, nameSeg = null;
  for (let i = patSegs.length - 1; i >= 0; i--) {
    if (patSegs[i] !== '**' && patSegs[i].includes('*')) { fromEnd = patSegs.length - 1 - i; nameSeg = patSegs[i]; break; }
  }
  if (nameSeg === null) return pathSegs[pathSegs.length - 1];
  const seg = pathSegs[pathSegs.length - 1 - fromEnd] ?? pathSegs[pathSegs.length - 1];
  if (nameSeg === '*') return seg;
  const m = seg.match(new RegExp('^' + nameSeg.split('*').map(escapeRe).join('(.*)') + '$'));
  return m ? m[1] : seg;
}

/** registries: [{name, glob}] from fold-rules; falls back to the kit's default registry set. */
export function extractExtPoints(root, registries, opts = {}) {
  const regs = registries?.length ? registries : DEFAULT_REGISTRIES;
  const allPaths = candidatePaths(root, opts);
  const points = regs.map(({ name, glob }) => {
    const matched = allPaths.filter(p => globMatch(glob, p));
    const installed = [...new Set(matched.map(p => installedNameFor(glob, p)))].sort();
    return { name, glob, count: matched.length, installed };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.glob.localeCompare(b.glob));
  return { points };
}
