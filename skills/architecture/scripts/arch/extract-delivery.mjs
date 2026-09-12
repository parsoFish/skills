// Extract delivery pipelines: GitHub Actions workflows (minimal line-based YAML subset parser,
// no YAML lib) plus Makefile deploy/apply/plan targets. Deterministic, read-only.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles } from './walk.mjs';

function leadingSpaces(s) { return s.match(/^ */)[0].length; }
function stripQuotes(s) { return s.replace(/^['"]|['"]$/g, ''); }

function stripInlineComment(s) {
  const i = s.indexOf(' #');
  if (i === -1) return s;
  const before = s.slice(0, i);
  if ((before.match(/'/g) ?? []).length % 2 !== 0 || (before.match(/"/g) ?? []).length % 2 !== 0) return s;
  return s.slice(0, i);
}

// Groups a raw-line slice by its shallowest indent level; deeper lines become that entry's body.
// Good enough for the mapping/list shapes GitHub Actions workflows actually use.
function groupByTopIndent(rawLines) {
  const meaningful = rawLines
    .map(raw => ({ raw, indent: leadingSpaces(raw), text: stripInlineComment(raw.slice(leadingSpaces(raw))) }))
    .filter(l => l.text.trim() !== '' && !l.text.trim().startsWith('#'));
  if (!meaningful.length) return { groups: [] };
  const topIndent = Math.min(...meaningful.map(l => l.indent));
  const groups = [];
  for (const l of meaningful) {
    if (l.indent === topIndent) groups.push({ indent: l.indent, headerText: l.text, bodyRawLines: [] });
    else if (groups.length) groups[groups.length - 1].bodyRawLines.push(l.raw);
  }
  return { groups };
}

function parseInlineList(t) {
  let s = t.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  return s.split(',').map(x => stripQuotes(x.trim())).filter(Boolean);
}

function parseTriggers(inline, bodyRawLines) {
  if (inline.trim()) return parseInlineList(inline).sort();
  const { groups } = groupByTopIndent(bodyRawLines);
  const names = groups.map(g => { const m = g.headerText.match(/^-?\s*['"]?([A-Za-z0-9_-]+)['"]?:?/); return m ? m[1] : g.headerText; });
  return [...new Set(names)].filter(Boolean).sort();
}

function parseNeeds(inline, bodyRawLines) {
  if (inline.trim()) return parseInlineList(inline).sort();
  const { groups } = groupByTopIndent(bodyRawLines);
  return groups.map(g => stripQuotes(g.headerText.replace(/^-\s?/, '').trim())).filter(Boolean).sort();
}

function parseStepEntry(headerRemainder, bodyRawLines, dashIndent) {
  const baseIndent = dashIndent + 2;
  const lines = [{ indent: baseIndent, text: headerRemainder }, ...bodyRawLines.map(r => ({ indent: leadingSpaces(r), text: stripInlineComment(r.slice(leadingSpaces(r))) }))];
  const step = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.indent !== baseIndent) continue;
    const m = l.text.match(/^(name|run|uses):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value === '' || /^[|>][+-]?$/.test(value)) {
      const next = lines.slice(i + 1).find(x => x.indent > baseIndent && x.text.trim() !== '');
      if (next) value = next.text.trim();
    }
    if (value) step[m[1]] = stripQuotes(value);
  }
  return step;
}

function parseSteps(rawLines) {
  const { groups } = groupByTopIndent(rawLines);
  return groups.map(g => parseStepEntry(g.headerText.replace(/^-\s?/, ''), g.bodyRawLines, g.indent));
}

function parseJob(jobGroup) {
  const id = (jobGroup.headerText.match(/^([A-Za-z0-9_.-]+):/) ?? [, jobGroup.headerText.trim()])[1];
  const { groups } = groupByTopIndent(jobGroup.bodyRawLines);
  const job = { id, needs: [], steps: [] };
  for (const g of groups) {
    const m = g.headerText.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) continue;
    if (m[1] === 'needs') job.needs = parseNeeds(m[2], g.bodyRawLines);
    else if (m[1] === 'runs-on') job.runsOn = stripQuotes(m[2].trim());
    else if (m[1] === 'steps') job.steps = parseSteps(g.bodyRawLines);
  }
  return job;
}

function parseWorkflow(file, text) {
  const { groups } = groupByTopIndent(text.split(/\r?\n/));
  let name = null, onInline = '', onLines = [], jobGroups = [];
  for (const g of groups) {
    const m = g.headerText.match(/^["']?(on|name|jobs)["']?:\s*(.*)$/);
    if (!m) continue;
    if (m[1] === 'name') name = stripQuotes(m[2].trim()) || null;
    else if (m[1] === 'on') { onInline = m[2]; onLines = g.bodyRawLines; }
    else if (m[1] === 'jobs') jobGroups = groupByTopIndent(g.bodyRawLines).groups;
  }
  const jobs = jobGroups.map(parseJob).sort((a, b) => a.id.localeCompare(b.id));
  return { file, name, triggers: parseTriggers(onInline, onLines), jobs };
}

function parseMakeTargets(text) {
  const targets = [];
  for (const line of text.split(/\r?\n/)) { const m = line.match(/^([A-Za-z0-9][A-Za-z0-9_-]*)\s*:(?!=)/); if (m) targets.push(m[1]); }
  return [...new Set(targets)].sort();
}

const WORKFLOWS_PREFIX = '.github/workflows/';

/** GitHub Actions workflows + Makefile deploy/apply/plan targets. */
export function extractDelivery(root, opts = {}) {
  const { ignore = [] } = opts;
  const notes = [];
  const files = walkFiles(root, { ignore, exts: ['.yml', '.yaml'] }).filter(f => f.startsWith(WORKFLOWS_PREFIX)).sort();
  if (!files.length) notes.push('no .github/workflows found');
  const workflows = files.map(f => parseWorkflow(f, readFileSync(join(root, f), 'utf8')));

  const makefilePath = join(root, 'Makefile');
  if (existsSync(makefilePath)) {
    const targets = parseMakeTargets(readFileSync(makefilePath, 'utf8')).filter(t => /^(deploy|apply|plan)(-|$)/.test(t));
    if (targets.length) workflows.push({ file: 'Makefile', jobs: targets.map(id => ({ id })) });
  }

  workflows.sort((a, b) => a.file.localeCompare(b.file));
  return { workflows, requiredChecks: null, notes };
}
