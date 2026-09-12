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

function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** Every failing/unenforced rule id in reference/fitness.json must be named somewhere in risks.md. */
function checkRisksFailingRules(docsRoot, risksMd) {
  const fitness = readJson(join(docsRoot, 'reference', 'fitness.json'));
  if (!fitness) return AGENT(['reference/fitness.json not found; cannot join']);
  const failing = (fitness.results ?? []).filter(r => !r.ok).map(r => r.id);
  const missing = failing.filter(id => !new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(risksMd));
  return { status: missing.length === 0 ? 'ok' : 'fail', detail: missing };
}

const RISKY = risk => {
  if (risk === undefined || risk === null) return false;
  if (typeof risk === 'number') return risk >= 2;
  return ['medium', 'high', 'critical'].includes(String(risk).toLowerCase());
};

/** Every dep in reference/deps.json flagged unused or risk>=medium must be named somewhere in risks.md. */
function checkRisksRiskyDeps(docsRoot, risksMd) {
  const deps = readJson(join(docsRoot, 'reference', 'deps.json'));
  if (!deps) return AGENT(['reference/deps.json not found; cannot join']);
  const risky = (deps.deps ?? []).filter(d => d.unused || RISKY(d.risk)).map(d => d.name);
  const missing = risky.filter(name => !risksMd.includes(name));
  return { status: missing.length === 0 ? 'ok' : 'fail', detail: missing };
}

/** Every view named in stakeholders.md's third column must exist as a file, or as a ✓/partial CHECKLIST row. */
function checkViewsExist(docsRoot, stakeholdersMd) {
  const checklistPath = findFile(docsRoot, 'CHECKLIST.md');
  const checkedOff = new Set();
  if (checklistPath) {
    for (const t of parseMdTables(readFileSync(checklistPath, 'utf8'))) {
      const statusIdx = colIndex(t.headers, 'status') === -1 ? 1 : colIndex(t.headers, 'status');
      for (const row of t.rows) if (/✓|partial/i.test(row[statusIdx] ?? '')) checkedOff.add(String(row[0]).toLowerCase());
    }
  }
  const allFiles = walk(docsRoot).map(p => p.toLowerCase());
  const missing = [];
  for (const table of parseMdTables(stakeholdersMd)) {
    if (table.headers.length < 3) continue;
    for (const row of table.rows) {
      const raw = row[2];
      if (!raw || !raw.trim()) continue;
      for (const name of raw.split(/[,;]/).map(s => s.trim()).filter(Boolean)) {
        const norm = name.toLowerCase();
        const existsAsFile = allFiles.some(p => p.endsWith(`/${norm}.md`) || p.endsWith(`/${norm}`));
        if (!existsAsFile && !checkedOff.has(norm)) missing.push(name);
      }
    }
  }
  return { ok: missing.length === 0, detail: [...new Set(missing)] };
}

// Fixed legend kind tokens (assets/legend.c4) and the house-style display names a glossary term
// might use for each. "system" is the generic container keyword, not an archetype kind.
const KIND_TERMS = {
  human: ['human'],
  webui: ['web ui', 'webui'],
  service: ['service', 'daemon'],
  cli: ['cli'],
  agent: ['llm agent', 'agent'],
  knowledge: ['knowledge store', 'knowledge'],
  log: ['append-only log', 'log'],
  workspace: ['workspace'],
  external: ['external system', 'external'],
  modelapi: ['model api', 'modelapi'],
  iacmodule: ['iac module', 'iacmodule'],
};

/** Every element kind used in architecture/model/generated.c4 must have a glossary term. */
function checkGlossaryKinds(docsRoot, glossaryMd) {
  const c4Path = join(docsRoot, 'architecture', 'model', 'generated.c4');
  if (!existsSync(c4Path)) return AGENT(['architecture/model/generated.c4 not found; cannot join']);
  const text = readFileSync(c4Path, 'utf8');
  const used = new Set();
  for (const kind of Object.keys(KIND_TERMS)) {
    if (new RegExp(`(^|\\s)${kind}\\s+\\S+\\s+'`, 'm').test(text)) used.add(kind);
  }
  const terms = parseMdTables(glossaryMd).flatMap(t => t.rows.map(r => norm(r[0] ?? '')));
  const missing = [...used].filter(kind => !KIND_TERMS[kind].some(alias => terms.some(t => t.includes(norm(alias)) || norm(alias).includes(t))));
  return { status: missing.length === 0 ? 'ok' : 'fail', detail: missing };
}

const CITATION_RE = /`[^`]+`|\bADR[- ]?\d+\b|\b\d{3}-[\w-]+\.md\b|[\w.-]+\/[\w./-]+/i;

/** Every glossary row's last column must cite a path, an ADR, or a code symbol. */
function checkGlossaryMapped(glossaryMd) {
  const missing = [];
  for (const table of parseMdTables(glossaryMd)) {
    if (table.headers.length < 2) continue;
    const last = table.headers.length - 1;
    for (const row of table.rows) if (!CITATION_RE.test(row[last] ?? '')) missing.push(row[0] ?? '(unnamed row)');
  }
  return { ok: missing.length === 0, detail: missing };
}

/** Every secret-like env var (reference/env.json) must appear in signals.md or secrets.md. */
function checkSignalsEmitters(docsRoot, signalsMd) {
  const env = readJson(join(docsRoot, 'reference', 'env.json'));
  if (!env) return AGENT(['reference/env.json not found; cannot join']);
  const secretsPath = findFile(docsRoot, 'secrets.md');
  const secretsMd = secretsPath ? readFileSync(secretsPath, 'utf8') : '';
  const missing = (env.secretLike ?? []).filter(name => !signalsMd.includes(name) && !secretsMd.includes(name));
  return { status: missing.length === 0 ? 'ok' : 'fail', detail: missing };
}

/** Every risks.md row's trigger cell must be non-empty. */
function checkSignalsRiskTriggers(docsRoot) {
  const risksPath = findFile(docsRoot, 'risks.md');
  if (!risksPath) return AGENT(['risks.md not found; cannot join']);
  const risksMd = readFileSync(risksPath, 'utf8');
  const hadColumn = parseMdTables(risksMd).some(t => colIndex(t.headers, 'trigger') !== -1);
  if (!hadColumn) return AGENT(['no \'trigger\' column in risks.md']);
  const missing = schemaNonEmpty(risksMd, ['trigger']);
  return { status: missing.length === 0 ? 'ok' : 'fail', detail: missing };
}

function evalCriterion(id, { md, docsRoot, opts }) {
  switch (id) {
    case 'risks.row-schema': { const r = checkRiskRowSchema(md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'risks.reviewed': { if (opts.now === undefined) return { status: 'agent', detail: ['date check skipped: pass --now YYYY-MM-DD to evaluate deterministically'] }; const r = checkRiskReviewed(md, opts.now); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'risks.failing-rules': return checkRisksFailingRules(docsRoot, md);
    case 'risks.risky-deps': return checkRisksRiskyDeps(docsRoot, md);
    case 'stakeholders.defaults': { const r = checkStakeholderDefaults(md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'stakeholders.views-covered': { const r = checkViewsCovered(docsRoot, md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'stakeholders.views-exist': { const r = checkViewsExist(docsRoot, md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'glossary.retired': { const r = checkRetired(docsRoot, opts.retired); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'glossary.frequent-nouns': { const r = checkFrequentNouns(docsRoot, md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'glossary.kinds': return checkGlossaryKinds(docsRoot, md);
    case 'glossary.mapped': { const r = checkGlossaryMapped(md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'deps.why': { const r = checkDepsSchema(md); return { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'deps.used': { const r = checkDepsUsed(md); return r.agent ? AGENT(r.detail) : { status: r.ok ? 'ok' : 'fail', detail: r.detail }; }
    case 'signals.emitters': return checkSignalsEmitters(docsRoot, md);
    case 'signals.risk-triggers': return checkSignalsRiskTriggers(docsRoot);
    default: return AGENT(['not evaluated: requires signals beyond this register\'s text']);
  }
}

/** criteria: the completeness.json shape { "<register>": [{id, check, rule}] }. opts: { now, retired, minScenarios }. */
export function evaluate(docsRoot, criteria, opts = {}) {
  const registers = [];
  let failing = 0;
  let unknown = 0;
  for (const [key, checks] of Object.entries(criteria)) {
    const isDir = key === 'scenarios';
    const path = isDir ? findDir(docsRoot, 'scenarios') : findFile(docsRoot, key);
    const present = isDir ? path && readdirSync(path).some(f => f.endsWith('.md')) : !!path;
    const md = !isDir && present ? readFileSync(path, 'utf8') : '';
    const criteriaOut = checks.map(({ id, check }) => {
      if (!present) return { id, status: 'missing', detail: [] };
      if (check === 'agent') return { id, ...AGENT([]) };
      if (isDir) {
        if (id === 'scenarios.minimum') {
          if (opts.minScenarios === undefined) return { id, status: 'agent', detail: ['minimum count skipped: pass opts.minScenarios to evaluate deterministically'] };
          const count = readdirSync(path).filter(f => f.endsWith('.md')).length;
          const ok = count >= opts.minScenarios;
          return { id, status: ok ? 'ok' : 'fail', detail: ok ? [] : [`found ${count}, need ${opts.minScenarios}`] };
        }
        return { id, ...AGENT(['scenario directory present; per-scenario evaluation needs kind/flow context']) };
      }
      return { id, ...evalCriterion(id, { md, docsRoot, opts }) };
    });
    for (const c of criteriaOut) {
      if (c.status === 'fail' || c.status === 'missing') failing++;
      else if (c.status === 'agent') unknown++;
    }
    registers.push({ file: key, criteria: criteriaOut });
  }
  const verdict = failing > 0 ? 'fail' : unknown > 0 ? 'unknown' : 'ok';
  return { registers, failing, unknown, verdict };
}
