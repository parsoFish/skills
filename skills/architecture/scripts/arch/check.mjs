// arch check — evaluate kit default rules over a docs tree. Deterministic; returns structured results.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

export function walk(dir, out = []) { if (!existsSync(dir)) return out; for (const f of readdirSync(dir)) { const p = join(dir, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; }

export const DEFAULT_RULES = [
  { id: 'docs.size-cap', concept: 'bloat', description: 'written docs stay under the line cap; reference/ and archive/ are exempt' },
  { id: 'docs.reference-generated', concept: 'generation', description: 'every file under reference/ carries a generated header' },
  { id: 'docs.no-blank-checklist', concept: 'completeness', description: 'CHECKLIST rows are ✓, partial, MISSING, or n/a with a reason' },
  { id: 'docs.checklist-complete', concept: 'completeness', description: 'no required view is MISSING' },
  { id: 'naming.retired', concept: 'naming', description: 'retired terms do not appear in docs' },
  { id: 'docs.cited-paths-exist', concept: 'bloat', description: 'every source path or dir/file.ext:LINE cited in written docs still exists under root (bloat rule 6, the staleness detector)' },
  { id: 'docs.cell-length', concept: 'bloat', description: 'no markdown table cell in written docs exceeds 220 characters' },
  { id: 'docs.view-shape', concept: 'completeness', description: 'loop.md, signals.md, secrets.md and journeys/*.md carry a mermaid block or an svg where they exist' },
  { id: 'docs.source-sha', concept: 'generation', description: 'generated files under reference/ carry source: <sha> in their first 5 lines when a sha is checked' },
];

const CELL_LENGTH_CAP = 220;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** dir/file.ext or dir/file.ext:LINE tokens, at least one path separator, excluding URLs. */
function citedPaths(text) {
  const stripped = text.replace(/https?:\/\/\S+/g, '');
  const re = /(?:^|[\s(`'"|])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})(:(\d+))?/g;
  const out = new Set();
  let m;
  while ((m = re.exec(stripped))) out.add(m[1]);
  return [...out];
}

// Only hand-written docs are checked: the kit's own generated files (_run/, CHECKLIST.md, AGENTS-ARCH.md) carry
// doc-relative links, not source citations. A cite counts as existing if it resolves against the source root,
// the docs root, or the citing document's own directory.
const KIT_WRITTEN_RE = /\/architecture\/(_run\/|CHECKLIST\.md$|AGENTS-ARCH\.md$|model\/)/;
function checkCitedPaths(files, docsRoot, root) {
  if (!root) return { ok: true, detail: [] };
  const missing = [];
  for (const p of files) {
    if (!/\/architecture\//.test(p) || KIT_WRITTEN_RE.test(p)) continue;
    for (const cite of citedPaths(readFileSync(p, 'utf8'))) {
      const clean = cite.replace(/:\d+$/, '');
      const ok = [join(root, clean), join(docsRoot, clean), join(dirname(p), clean)].some(c => existsSync(c));
      if (!ok) missing.push(`${relative(docsRoot, p)}: ${cite}`);
    }
  }
  return { ok: missing.length === 0, detail: missing };
}

function checkCellLength(files, docsRoot) {
  const over = [];
  for (const p of files) {
    const lines = readFileSync(p, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!TABLE_ROW_RE.test(line) || TABLE_SEP_RE.test(line)) return;
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
      if (cells.some(c => c.trim().length > CELL_LENGTH_CAP)) over.push(`${relative(docsRoot, p)}:${i + 1}`);
    });
  }
  return { ok: over.length === 0, detail: over };
}

const VIEW_SHAPED = ['loop.md', 'signals.md', 'secrets.md'];
const hasDiagram = text => /```mermaid/.test(text) || /<svg/i.test(text);

function checkViewShape(docsRoot) {
  const missing = [];
  for (const name of VIEW_SHAPED) {
    const p = join(docsRoot, 'architecture', name);
    if (existsSync(p) && !hasDiagram(readFileSync(p, 'utf8'))) missing.push(`architecture/${name}`);
  }
  const journeysDir = join(docsRoot, 'architecture', 'journeys');
  if (existsSync(journeysDir)) {
    for (const f of readdirSync(journeysDir).filter(f => f.endsWith('.md'))) {
      const p = join(journeysDir, f);
      if (!hasDiagram(readFileSync(p, 'utf8'))) missing.push(`architecture/journeys/${f}`);
    }
  }
  return { ok: missing.length === 0, detail: missing };
}

function checkSourceSha(refs, docsRoot, sha) {
  if (!sha) return { ok: true, detail: [] };
  const re = new RegExp(`source:\\s*${sha.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const missing = refs.filter(p => p.endsWith('.md') && !re.test(readFileSync(p, 'utf8').split(/\r?\n/).slice(0, 5).join('\n'))).map(p => relative(docsRoot, p));
  return { ok: missing.length === 0, detail: missing };
}

export function check(docsRoot, { cap = 400, retired = [], root, sha } = {}) {
  const results = [];
  const files = walk(docsRoot).filter(p => p.endsWith('.md'));
  const written = files.filter(p => !/\/(reference|archive)\//.test(p));
  const over = written.map(p => ({ p: relative(docsRoot, p), n: readFileSync(p, 'utf8').split(/\r?\n/).length })).filter(x => x.n > cap);
  results.push({ id: 'docs.size-cap', ok: over.length === 0, detail: over.map(x => `${x.p} ${x.n}`) });
  const refs = files.filter(p => /\/reference\//.test(p));
  const noHeader = refs.filter(p => !/^(<!--\s*)?generated /m.test(readFileSync(p, 'utf8').split(/\r?\n/).slice(0, 5).join('\n'))).map(p => relative(docsRoot, p));
  results.push({ id: 'docs.reference-generated', ok: noHeader.length === 0, detail: noHeader });
  const cl = files.find(p => p.endsWith('CHECKLIST.md'));
  let blank = [];
  let missing = [];
  if (cl) {
    const rows = readFileSync(cl, 'utf8').split(/\r?\n/).filter(l => /^\|/.test(l) && !/^\|\s*(view|-)/i.test(l));
    blank = rows.filter(l => !/(✓|partial|MISSING|n\/a:\s*\S)/.test(l));
    missing = rows.filter(l => /\|\s*MISSING\s*\|/.test(l)).map(l => l.split('|')[1].trim());
  }
  results.push({ id: 'docs.no-blank-checklist', ok: !!cl && blank.length === 0, detail: cl ? blank : ['CHECKLIST.md missing'] });
  results.push({ id: 'docs.checklist-complete', ok: !!cl && missing.length === 0, detail: cl ? missing : ['CHECKLIST.md missing'] });
  const hits = [];
  if (retired.length) { const re = new RegExp(`\\b(${retired.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i'); for (const p of files) if (!/\/decisions\//.test(p) && re.test(readFileSync(p, 'utf8'))) hits.push(relative(docsRoot, p)); }
  results.push({ id: 'naming.retired', ok: hits.length === 0, detail: hits });
  const cited = checkCitedPaths(written, docsRoot, root);
  results.push({ id: 'docs.cited-paths-exist', ...cited });
  const cellLen = checkCellLength(written, docsRoot);
  results.push({ id: 'docs.cell-length', ...cellLen });
  const viewShape = checkViewShape(docsRoot);
  results.push({ id: 'docs.view-shape', ...viewShape });
  const sourceSha = checkSourceSha(refs, docsRoot, sha);
  results.push({ id: 'docs.source-sha', ...sourceSha });
  return { ok: results.every(r => r.ok), results };
}
