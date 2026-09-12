// Evaluate written registers against references/completeness.json. Deterministic and
// self-contained: only the checks whose rule is fully decidable from docsRoot text are actually
// scored (schema, the three named joins, date, frequency); every other declared criterion —
// whatever its check type — reports 'agent' with a note, since deciding it needs signals this
// function is not given (fitness.json, model kinds, flow gates, code-derived emitters, ...).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function parseMdTables(md) {
  const lines = String(md).split(/\r?\n/);
  const isRow = l => /^\s*\|.*\|\s*$/.test(l ?? '');
  const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l ?? '');
  const split = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (isRow(lines[i]) && isSep(lines[i + 1])) {
      const headers = split(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && isRow(lines[i])) { rows.push(split(lines[i])); i++; }
      tables.push({ headers, rows });
      i--;
    }
  }
  return tables;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const colIndex = (headers, name) => {
  const t = norm(name);
  return headers.findIndex(h => norm(h) === t || norm(h).includes(t));
};

function schemaNonEmpty(md, columns) {
  const missing = [];
  for (const table of parseMdTables(md)) {
    const idx = columns.map(c => colIndex(table.headers, c));
    if (idx.some(i => i === -1)) continue;
    for (const row of table.rows) {
      if (idx.some(i => !row[i] || !row[i].trim())) missing.push(row[0] ?? '(unnamed row)');
    }
  }
  return missing;
}

function checkRiskRowSchema(md) {
  const missing = schemaNonEmpty(md, ['likelihood', 'impact', 'trigger', 'mitigation', 'owner']);
  return { ok: missing.length === 0, detail: missing };
}

function checkRiskReviewed(md, now) {
  if (now === undefined) return { status: 'agent', detail: ['date check skipped: pass --now YYYY-MM-DD to evaluate deterministically'] };
  const m = md.match(/\breviewed:\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) return { ok: false, detail: ['no "reviewed: YYYY-MM-DD" header line'] };
  const days = (new Date(now) - new Date(m[1])) / 86400000;
  return { ok: days >= 0 && days <= 30, detail: days >= 0 && days <= 30 ? [] : [`reviewed ${m[1]}, ${Math.round(days)} days ago`] };
}

const DEFAULT_STAKEHOLDERS = ['operator', 'future maintainer', 'coding agent', 'reviewing agent', 'reader', 'security reviewer', 'end user'];

function checkStakeholderDefaults(md) {
  const lower = md.toLowerCase();
  const firstCols = new Set(parseMdTables(md).flatMap(t => t.rows.map(r => (r[0] ?? '').toLowerCase())));
  const missing = DEFAULT_STAKEHOLDERS.filter(name => {
    if ([...firstCols].some(c => c.includes(name))) return false;
    return !new RegExp(`struck:\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[—-]`, 'i').test(lower);
  });
  return { ok: missing.length === 0, detail: missing };
}

function checkViewsCovered(docsRoot, stakeholdersMd) {
  const checklistPath = findFile(docsRoot, 'CHECKLIST.md');
  if (!checklistPath) return { ok: false, detail: ['CHECKLIST.md missing'] };
  const tables = parseMdTables(readFileSync(checklistPath, 'utf8'));
  const covered = new Set();
  for (const t of tables) {
    const statusIdx = colIndex(t.headers, 'status') === -1 ? 1 : colIndex(t.headers, 'status');
    for (const row of t.rows) if (/✓|partial/i.test(row[statusIdx] ?? '')) covered.add(row[0]);
  }
  const lower = stakeholdersMd.toLowerCase();
  const missing = [...covered].filter(v => !lower.includes(String(v).toLowerCase()));
  return { ok: missing.length === 0, detail: missing };
}

function findFile(docsRoot, basename) {
  return walk(docsRoot).find(p => p.endsWith(`/${basename}`) || p === basename) ?? null;
}

function findDir(docsRoot, basename) {
  if (!existsSync(docsRoot)) return null;
  const stack = [docsRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (f === basename) return p; stack.push(p); }
    }
  }
  return null;
}

function checkRetired(docsRoot, retired) {
  if (!retired?.length) return { ok: true, detail: [] };
  const re = new RegExp(`\\b(${retired.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  const hits = walk(docsRoot).filter(p => p.endsWith('.md')).filter(p => re.test(readFileSync(p, 'utf8'))).map(p => relative(docsRoot, p));
  return { ok: hits.length === 0, detail: hits };
}

function checkFrequentNouns(docsRoot, glossaryMd) {
  const glossaryTerms = new Set(parseMdTables(glossaryMd).flatMap(t => t.rows.map(r => (r[0] ?? '').toLowerCase())));
  const archDir = findDir(docsRoot, 'architecture') ?? docsRoot;
  const files = walk(archDir).filter(p => p.endsWith('.md') && !p.includes(`${archDir}/_run`) && !/[/\\]_run[/\\]/.test(p));
  const counts = new Map();
  for (const p of files) {
    // mid-sentence capitalised words only (preceded by a lowercase word), so sentence starts and headings do not count
    const text = readFileSync(p, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    for (const m of text.matchAll(/[a-z,;] ([A-Z][a-z]{3,})\b/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const frequent = [...counts.entries()].filter(([w, n]) => n >= 3 && !glossaryTerms.has(w.toLowerCase())).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { ok: frequent.length === 0, detail: frequent.map(([w, n]) => `${w} (${n})`) };
}

function checkDepsSchema(md) {
  const missing = schemaNonEmpty(md, ['why', 'exit plan']);
  return { ok: missing.length === 0, detail: missing };
}

function checkDepsUsed(md) {
  const unused = [];
  for (const table of parseMdTables(md)) {
    const idx = colIndex(table.headers, 'unused');
    if (idx === -1) continue;
    for (const row of table.rows) if (/^yes$/i.test((row[idx] ?? '').trim())) unused.push(row[0]);
  }
  const hadColumn = parseMdTables(md).some(t => colIndex(t.headers, 'unused') !== -1);
  if (!hadColumn) return { agent: true, detail: ["no 'unused' column in deps.md"] };
  return { ok: unused.length === 0, detail: unused };
}

const AGENT = detail => ({ status: 'agent', detail });

function evalCriterion(id, { md, docsRoot, opts }) {
  switch (id) {
    case 'risks.row-schema': { const r = checkRiskRowSchema(md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'risks.reviewed': { if (opts.now === undefined) return { status: 'agent', detail: ['date check skipped: pass --now YYYY-MM-DD to evaluate deterministically'] }; const r = checkRiskReviewed(md, opts.now); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'stakeholders.defaults': { const r = checkStakeholderDefaults(md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'stakeholders.views-covered': { const r = checkViewsCovered(docsRoot, md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'glossary.retired': { const r = checkRetired(docsRoot, opts.retired); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'glossary.frequent-nouns': { const r = checkFrequentNouns(docsRoot, md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'deps.why': { const r = checkDepsSchema(md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'deps.used': { const r = checkDepsUsed(md); return r.agent ? AGENT(r.detail) : { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    default: return AGENT(['not evaluated: requires signals beyond this register\'s text']);
  }
}

/** criteria: the completeness.json shape { "<register>": [{id, check, rule}] }. opts: { now, retired }. */
export function evaluate(docsRoot, criteria, opts = {}) {
  const registers = [];
  let failing = 0;
  for (const [key, checks] of Object.entries(criteria)) {
    const isDir = key === 'scenarios';
    const path = isDir ? findDir(docsRoot, 'scenarios') : findFile(docsRoot, key);
    const present = isDir ? path && readdirSync(path).some(f => f.endsWith('.md')) : !!path;
    const md = !isDir && present ? readFileSync(path, 'utf8') : '';
    const criteriaOut = checks.map(({ id, check }) => {
      if (!present) return { id, status: 'missing', detail: [] };
      if (check === 'agent') return { id, ...AGENT([]) };
      if (isDir) return { id, ...AGENT(['scenario directory present; per-scenario evaluation needs kind/flow context']) };
      return { id, ...evalCriterion(id, { md, docsRoot, opts }) };
    });
    for (const c of criteriaOut) if (c.status === 'fail' || c.status === 'missing') failing++;
    registers.push({ file: key, criteria: criteriaOut });
  }
  return { registers, failing };
}
