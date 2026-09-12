import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMdTables, evaluate } from './completeness.mjs';

function docs(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

const CRITERIA = {
  'risks.md': [
    { id: 'risks.row-schema', check: 'schema', rule: 'every row has likelihood, impact, trigger, mitigation, owner' },
    { id: 'risks.incidents', check: 'agent', rule: 'x' },
    { id: 'risks.reviewed', check: 'date', rule: 'reviewed within 30 days' },
  ],
  'stakeholders.md': [
    { id: 'stakeholders.defaults', check: 'schema', rule: 'defaults present or struck' },
    { id: 'stakeholders.views-covered', check: 'join', rule: 'every CHECKLIST view named' },
  ],
  'glossary.md': [
    { id: 'glossary.frequent-nouns', check: 'frequency', rule: 'frequent nouns termed' },
    { id: 'glossary.retired', check: 'join', rule: 'no retired term appears' },
  ],
  'deps.md': [
    { id: 'deps.why', check: 'schema', rule: 'why + exit plan non-empty' },
    { id: 'deps.used', check: 'join', rule: 'no unused=yes row' },
  ],
};

test('parseMdTables extracts headers and rows, ignoring the separator line', () => {
  const [t] = parseMdTables('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n');
  assert.deepEqual(t.headers, ['a', 'b']);
  assert.deepEqual(t.rows, [['1', '2'], ['3', '4']]);
});

test('parseMdTables finds multiple tables and skips prose between them', () => {
  const md = '# Title\n\nsome prose\n\n| a |\n|---|\n| x |\n\nmore prose\n\n| b | c |\n|---|---|\n| y | z |\n';
  const tables = parseMdTables(md);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[1].headers, ['b', 'c']);
});

test('missing register file: every criterion under it is "missing"', () => {
  const root = docs({});
  const r = evaluate(root, { 'risks.md': CRITERIA['risks.md'] }, { now: '2026-09-12' });
  assert.deepEqual(r.registers[0].criteria.map(c => c.status), ['missing', 'missing', 'missing']);
  assert.equal(r.failing, 3);
});

test('risks.row-schema fails when a row is missing a required column value', () => {
  const risks = 'reviewed: 2026-09-01\n\n| likelihood | impact | trigger | mitigation | owner |\n|---|---|---|---|---|\n| high | high | X happens | do Y | alice |\n| med |  | Z | fix | bob |\n';
  const root = docs({ 'architecture/risks.md': risks });
  const r = evaluate(root, { 'risks.md': CRITERIA['risks.md'] }, { now: '2026-09-12' });
  const schema = r.registers[0].criteria.find(c => c.id === 'risks.row-schema');
  assert.equal(schema.status, 'fail');
  assert.deepEqual(schema.detail, ['med']);
});

test('risks.reviewed passes within 30 days, fails when stale, agent check reports agent', () => {
  const fresh = 'reviewed: 2026-08-20\n\n| likelihood | impact | trigger | mitigation | owner |\n|---|---|---|---|---|\n';
  const root = docs({ 'architecture/risks.md': fresh });
  const r = evaluate(root, { 'risks.md': CRITERIA['risks.md'] }, { now: '2026-09-12' });
  assert.equal(r.registers[0].criteria.find(c => c.id === 'risks.reviewed').status, 'ok');
  assert.equal(r.registers[0].criteria.find(c => c.id === 'risks.incidents').status, 'agent');

  const stale = 'reviewed: 2026-01-01\n\n| likelihood |\n|---|\n';
  const root2 = docs({ 'architecture/risks.md': stale });
  const r2 = evaluate(root2, { 'risks.md': CRITERIA['risks.md'] }, { now: '2026-09-12' });
  assert.equal(r2.registers[0].criteria.find(c => c.id === 'risks.reviewed').status, 'fail');
});

test('risks.reviewed throws when opts.now is not supplied', () => {
  const root = docs({ 'architecture/risks.md': 'reviewed: 2026-08-20\n' });
  assert.throws(() => evaluate(root, { 'risks.md': CRITERIA['risks.md'] }, {}), /opts\.now/);
});

test('stakeholders.defaults: missing name fails; struck line counts as present', () => {
  const sh = '| stakeholder | concern |\n|---|---|\n| operator | can it run unattended |\n| coding agent | is the model clear |\n\nstruck: end user — no direct end users\n';
  const root = docs({ 'architecture/stakeholders.md': sh, 'architecture/CHECKLIST.md': '| view | status |\n|---|---|\n| context | ✓ |\n' });
  const r = evaluate(root, { 'stakeholders.md': CRITERIA['stakeholders.md'] }, {});
  const defaults = r.registers[0].criteria.find(c => c.id === 'stakeholders.defaults');
  assert.equal(defaults.status, 'fail');
  assert.ok(!defaults.detail.includes('end user'));
  assert.ok(!defaults.detail.includes('operator'));
  assert.ok(defaults.detail.includes('future maintainer'));
});

test('stakeholders.views-covered fails when a checked-off view is not mentioned in stakeholders.md', () => {
  const sh = '| stakeholder | concern |\n|---|---|\n| operator | context ok? |\n';
  const checklist = '| view | status |\n|---|---|\n| context | ✓ |\n| pipeline | partial |\n| loop | n/a: not a sim |\n';
  const root = docs({ 'architecture/stakeholders.md': sh, 'architecture/CHECKLIST.md': checklist });
  const r = evaluate(root, { 'stakeholders.md': CRITERIA['stakeholders.md'] }, {});
  const covered = r.registers[0].criteria.find(c => c.id === 'stakeholders.views-covered');
  assert.equal(covered.status, 'fail');
  assert.deepEqual(covered.detail, ['pipeline']);
});

test('glossary.retired fails when a retired term appears anywhere under docsRoot', () => {
  const root = docs({ 'architecture/glossary.md': '| term |\n|---|\n', 'architecture/overview.md': 'the old Widget still shows up\n' });
  const r = evaluate(root, { 'glossary.md': CRITERIA['glossary.md'] }, { retired: ['Widget'] });
  const retired = r.registers[0].criteria.find(c => c.id === 'glossary.retired');
  assert.equal(retired.status, 'fail');
  assert.ok(retired.detail[0].endsWith('overview.md'));
});

test('glossary.frequent-nouns lists capitalised nouns used 3+ times that are not glossed', () => {
  const overview = 'The Kernel handles it. Kernel again. And Kernel once more.\n';
  const glossary = '| term | meaning |\n|---|---|\n| Kernel | the core |\n';
  const root = docs({ 'architecture/glossary.md': glossary, 'architecture/overview.md': overview });
  const r = evaluate(root, { 'glossary.md': [{ id: 'glossary.frequent-nouns', check: 'frequency', rule: 'x' }] }, {});
  assert.equal(r.registers[0].criteria[0].status, 'ok'); // Kernel is glossed

  const ungrossed = 'The Widgetry runs. Widgetry twice. Widgetry thrice.\n';
  const root2 = docs({ 'architecture/glossary.md': glossary, 'architecture/overview.md': ungrossed });
  const r2 = evaluate(root2, { 'glossary.md': [{ id: 'glossary.frequent-nouns', check: 'frequency', rule: 'x' }] }, {});
  assert.equal(r2.registers[0].criteria[0].status, 'fail');
  assert.ok(r2.registers[0].criteria[0].detail[0].startsWith('Widgetry'));
});

test('deps.why fails on a row missing exit plan; deps.used flags unused=yes rows', () => {
  const deps = '| name | why | exit plan | unused |\n|---|---|---|---|\n| lodash | utils | none, accepted | no |\n| left-pad | pad strings |  | yes |\n';
  const root = docs({ 'reference/deps.md': deps });
  const r = evaluate(root, { 'deps.md': CRITERIA['deps.md'] }, {});
  const why = r.registers[0].criteria.find(c => c.id === 'deps.why');
  assert.equal(why.status, 'fail');
  assert.deepEqual(why.detail, ['left-pad']);
  const used = r.registers[0].criteria.find(c => c.id === 'deps.used');
  assert.equal(used.status, 'fail');
  assert.deepEqual(used.detail, ['left-pad']);
});

test('deps.used falls back to agent when there is no unused column to read', () => {
  const deps = '| name | why | exit plan |\n|---|---|---|\n| lodash | utils | none |\n';
  const root = docs({ 'reference/deps.md': deps });
  const r = evaluate(root, { 'deps.md': CRITERIA['deps.md'] }, {});
  assert.equal(r.registers[0].criteria.find(c => c.id === 'deps.used').status, 'agent');
});

test('scenarios is a directory register: missing dir means missing, present dir means agent (needs kind/flow context)', () => {
  const criteria = { scenarios: [{ id: 'scenarios.minimum', check: 'join', rule: 'x' }] };
  const rootMissing = docs({});
  assert.equal(evaluate(rootMissing, criteria, {}).registers[0].criteria[0].status, 'missing');

  const rootPresent = docs({ 'architecture/scenarios/happy-path.md': '# scenario\n' });
  assert.equal(evaluate(rootPresent, criteria, {}).registers[0].criteria[0].status, 'agent');
});

test('failing counts fail + missing but not agent or ok', () => {
  const root = docs({ 'architecture/risks.md': 'reviewed: 2026-01-01\n' });
  const r = evaluate(root, { 'risks.md': CRITERIA['risks.md'], 'stakeholders.md': CRITERIA['stakeholders.md'] }, { now: '2026-09-12' });
  // risks.row-schema: no table -> ok (nothing to flag); risks.incidents: agent; risks.reviewed: fail (stale)
  // stakeholders.md missing entirely -> 2 missing
  assert.equal(r.failing, 3);
});
