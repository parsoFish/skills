#!/usr/bin/env node
// Renders evals/gate-report.json + evals/attest/*.json into evals/REPORT.md — the human-readable,
// tracked, greppable record a PR body points at. Deterministic given its inputs: same report + same
// evidence always renders the same bytes, so `git diff` on REPORT.md is exactly "what changed".
// Usage: node scripts/report.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RERUN_CMD = 'setsid nohup node scripts/gate.mjs --all --force > /tmp/gate.log 2>&1 &';

const dash = v => (v === undefined || v === null || v === '' ? '—' : v);
const cell = v => String(dash(v)).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const money = v => (typeof v === 'number' ? `$${v.toFixed(2)}` : '—');
const minutes = v => (typeof v === 'number' ? `${(v / 60).toFixed(1)} min` : '—');

function table(headers, rows) {
  if (rows.length === 0) return '_none_\n';
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${r.map(cell).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}\n`;
}

/** One of: attested pass, deterministic-only pass, a recorded bypass, or fail. Tolerant of schema 1,
 * which carries none of `attested`/`bypass` and just an overall `ok`. */
function verdictLabel(report) {
  if (report.attested === true) return 'PASS — attested';
  if (report.bypass) return `BYPASSED — ${report.bypass}`;
  if (report.ok === true) return 'PASS — not attested (deterministic only, or schema 1)';
  return 'FAIL';
}

function header(report) {
  const totals = report.totals ?? {};
  const lines = [
    `# Gate report — ${verdictLabel(report)}`,
    '',
    `| field | value |`,
    `| --- | --- |`,
    `| skillsDigest | \`${dash(report.skillsDigest && report.skillsDigest.slice(0, 12))}\` |`,
    `| commit | \`${dash(report.commit)}\` |`,
    `| generatedAt | ${dash(report.generatedAt)} |`,
    `| claudeVersion | ${dash(report.claudeVersion)} |`,
    `| pluginVersion | ${dash(report.pluginVersion)} |`,
    `| total cost | ${money(totals.costUsd)} |`,
    `| total duration | ${minutes(totals.durationSeconds)} |`,
    '',
  ];
  return lines.join('\n');
}

function stepsSection(report) {
  const rows = (report.steps ?? []).map(s => [s.name, s.ok ? 'ok' : 'FAIL', (s.detail ?? '').split('\n')[0]]);
  return `## Deterministic steps\n\n${table(['step', 'verdict', 'detail'], rows)}`;
}

/** Verdict for one case, tolerant of every field it might be missing under schema 1. */
function caseVerdict(c, evalBlock) {
  if (typeof c.exit === 'number' && c.exit !== 0) return 'FAIL (exit)';
  if (Array.isArray(c.errors) && c.errors.length) return 'FAIL (errored)';
  if (c.partial === true) return 'FAIL (partial)';
  if (evalBlock?.threshold != null && c.score != null && c.score < evalBlock.threshold) return 'FAIL (< threshold)';
  if (evalBlock?.minDelta != null && c.delta != null && c.delta < evalBlock.minDelta) return 'FAIL (< minDelta)';
  return c.score == null ? '—' : 'PASS';
}

function casesSection(report) {
  const evalBlock = report.eval ?? {};
  const cases = evalBlock.cases ?? [];
  // DELTA first after the name: that is the number the docs tell the reader to trust.
  const rows = cases.map(c => [c.name, c.delta, c.score, c.scoreWithout, c.turns, money(c.costUsd), minutes(c.durationSeconds), caseVerdict(c, evalBlock)]);
  const headRow = ['case', 'Δ', 'score', 'without', 'turns', 'cost', 'duration', 'verdict'];
  return `## Eval cases (threshold ${dash(evalBlock.threshold)}, minDelta ${dash(evalBlock.minDelta)})\n\n${table(headRow, rows)}`;
}

function graderPassed(entry) { return entry ? (entry.passed ? 'pass' : 'fail') : '—'; }

function graderRows(evidence) {
  const kase = evidence?.cases?.[0];
  if (!kase) return [];
  const withArm = kase.arms?.with?.[0]?.graders ?? [];
  const withoutArm = kase.arms?.without?.[0]?.graders ?? [];
  return (kase.graders ?? []).map(g => {
    const w = withArm.find(x => x.name === g.name);
    const wo = withoutArm.find(x => x.name === g.name);
    return [g.name, g.type, graderPassed(w), graderPassed(wo), (w ?? wo)?.explanation ?? '—'];
  });
}

function gradersSection(report, evidenceByCase) {
  const cases = report.eval?.cases ?? [];
  if (!cases.length) return '';
  const blocks = cases.map(c => {
    const rows = graderRows(evidenceByCase?.[c.name]);
    const body = rows.length ? table(['grader', 'type', 'with', 'without', 'explanation'], rows) : '_no evidence copied for this case_\n';
    return `### ${c.name}\n\n${body}`;
  });
  return `## Graders\n\n${blocks.join('\n')}`;
}

function reviewSection(report) {
  const review = report.review ?? {};
  const skills = Object.keys(review).sort();
  const rows = skills.map(s => {
    const r = review[s] ?? {};
    const findings = (r.findings ?? []).map(f => `[${f.severity}] ${f.finding}`).join('; ') || 'none';
    return [s, r.verdict ?? '—', findings, money(r.costUsd)];
  });
  return `## Structural review\n\n${table(['skill', 'verdict', 'findings', 'cost'], rows)}`;
}

function footer(report, ledgerTail) {
  const caseNames = (report.eval?.cases ?? []).map(c => c.name);
  const htmlLinks = caseNames.length
    ? caseNames.map(n => `- \`evals/results/${n}.html\` (not tracked; produced by the same run)`).join('\n')
    : '_none_';
  const ledger = (ledgerTail ?? []).length ? ledgerTail.join('\n') : '_no ledger entries yet_';
  return [
    '## Re-run',
    '',
    '```',
    RERUN_CMD,
    '```',
    '',
    '## Per-case reports',
    '',
    htmlLinks,
    '',
    '## Recent ledger',
    '',
    '```',
    ledger,
    '```',
    '',
  ].join('\n');
}

/** Pure and deterministic given its inputs: same report + same evidence always renders the same
 * bytes. Tolerant of schema 1 (no timestamps/costs/digests) by printing "—" for anything missing. */
export function renderReport(report, evidenceByCase = {}, { ledgerTail = [] } = {}) {
  return [
    '<!-- gate-report -->',
    header(report),
    stepsSection(report),
    '',
    casesSection(report),
    '',
    gradersSection(report, evidenceByCase),
    '',
    reviewSection(report),
    '',
    footer(report, ledgerTail),
  ].filter(Boolean).join('\n');
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (err) { throw new Error(`report.mjs: cannot read ${path}: ${err.message}`); }
}

/** Reads evals/gate-report.json plus the evidence it points at (or evals/attest/<case>.json when the
 * report predates the `evidence` field), writes evals/REPORT.md, and returns its path. */
export function writeReport(root) {
  const reportPath = join(root, 'evals', 'gate-report.json');
  if (!existsSync(reportPath)) throw new Error(`report.mjs: ${reportPath} does not exist — run the gate first`);
  const report = readJson(reportPath);
  const evidenceByCase = {};
  for (const c of report.eval?.cases ?? []) {
    const evidencePath = join(root, c.evidence ?? join('evals', 'attest', `${c.name}.json`));
    if (existsSync(evidencePath)) evidenceByCase[c.name] = readJson(evidencePath);
  }
  const ledgerPath = join(root, 'evals', 'ledger.md');
  const ledgerTail = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean).slice(-5) : [];
  const outPath = join(root, 'evals', 'REPORT.md');
  writeFileSync(outPath, renderReport(report, evidenceByCase, { ledgerTail }));
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = writeReport(ROOT);
  console.log(`report: wrote ${path}`);
}
