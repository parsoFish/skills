// arch check — evaluate kit default rules over a docs tree. Deterministic; returns structured results.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export function walk(dir, out = []) { if (!existsSync(dir)) return out; for (const f of readdirSync(dir)) { const p = join(dir, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; }

export const DEFAULT_RULES = [
  { id: 'docs.size-cap', concept: 'bloat', description: 'written docs stay under the line cap; reference/ and archive/ are exempt' },
  { id: 'docs.reference-generated', concept: 'generation', description: 'every file under reference/ carries a generated header' },
  { id: 'docs.no-blank-checklist', concept: 'completeness', description: 'CHECKLIST rows are ✓, partial, or n/a with a reason' },
  { id: 'naming.retired', concept: 'naming', description: 'retired terms do not appear in docs' },
];

export function check(docsRoot, { cap = 400, retired = [] } = {}) {
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
  if (cl) blank = readFileSync(cl, 'utf8').split(/\r?\n/).filter(l => /^\|/.test(l) && !/^\|\s*(view|-)/i.test(l)).filter(l => !/(✓|partial|n\/a:\s*\S)/.test(l));
  results.push({ id: 'docs.no-blank-checklist', ok: !!cl && blank.length === 0, detail: cl ? blank : ['CHECKLIST.md missing'] });
  const hits = [];
  if (retired.length) { const re = new RegExp(`\\b(${retired.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i'); for (const p of files) if (re.test(readFileSync(p, 'utf8'))) hits.push(relative(docsRoot, p)); }
  results.push({ id: 'naming.retired', ok: hits.length === 0, detail: hits });
  return { ok: results.every(r => r.ok), results };
}
