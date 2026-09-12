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

test('risks.reviewed is skipped as an agent check when opts.now is not supplied (keeps runs deterministic)', () => {
  const root = docs({ 'architecture/risks.md': 'reviewed: 2026-08-20\n' });
  const c = evaluate(root, { 'risks.md': CRITERIA['risks.md'] }, {}).registers[0].criteria.find(x => x.id === 'risks.reviewed');
  assert.equal(c.status, 'agent');
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

  const ungrossed = 'It uses the Widgetry daily, ships the Widgetry weekly, and tunes the Widgetry monthly.\n';
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

test('risks.failing-rules: agent without fitness.json; fails when a failing rule id is not named in risks.md; ok once it is', () => {
  const criteria = { 'risks.md': [{ id: 'risks.failing-rules', check: 'join', rule: 'x' }] };
  const noFitness = evaluate(docs({ 'architecture/risks.md': 'nothing here\n' }), criteria, {});
  assert.equal(noFitness.registers[0].criteria[0].status, 'agent');

  const fitness = JSON.stringify({ ok: false, results: [{ id: 'naming.retired', ok: false, detail: [] }, { id: 'docs.size-cap', ok: true, detail: [] }] });
  const missing = evaluate(docs({ 'architecture/risks.md': 'no rule ids here\n', 'reference/fitness.json': fitness }), criteria, {});
  assert.equal(missing.registers[0].criteria[0].status, 'fail');
  assert.deepEqual(missing.registers[0].criteria[0].detail, ['naming.retired']);

  const present = evaluate(docs({ 'architecture/risks.md': 'covers naming.retired already\n', 'reference/fitness.json': fitness }), criteria, {});
  assert.equal(present.registers[0].criteria[0].status, 'ok');
});

test('risks.risky-deps: every unused or risk>=medium dep must be named in risks.md', () => {
  const criteria = { 'risks.md': [{ id: 'risks.risky-deps', check: 'join', rule: 'x' }] };
  const deps = JSON.stringify({ deps: [{ name: 'left-pad', unused: true }, { name: 'lodash', risk: 'high' }, { name: 'safe-dep', risk: 'low' }] });
  const missing = evaluate(docs({ 'architecture/risks.md': 'mentions left-pad only\n', 'reference/deps.json': deps }), criteria, {});
  assert.equal(missing.registers[0].criteria[0].status, 'fail');
  assert.deepEqual(missing.registers[0].criteria[0].detail, ['lodash']);

  const ok = evaluate(docs({ 'architecture/risks.md': 'left-pad and lodash both covered\n', 'reference/deps.json': deps }), criteria, {});
  assert.equal(ok.registers[0].criteria[0].status, 'ok');
});

test('stakeholders.views-exist: a named view must exist as a file or a checked-off CHECKLIST row', () => {
  const criteria = { 'stakeholders.md': [{ id: 'stakeholders.views-exist', check: 'join', rule: 'x' }] };
  const sh = '| stakeholder | concern | view |\n|---|---|---|\n| operator | ok? | risks |\n| reader | ok? | phantom-view |\n';
  const r = evaluate(docs({ 'architecture/stakeholders.md': sh, 'architecture/risks.md': 'x\n' }), criteria, {});
  assert.equal(r.registers[0].criteria[0].status, 'fail');
  assert.deepEqual(r.registers[0].criteria[0].detail, ['phantom-view']);

  const shChecklist = '| stakeholder | concern | view |\n|---|---|---|\n| operator | ok? | pipeline |\n';
  const checklist = '| view | status |\n|---|---|\n| pipeline | ✓ |\n';
  const r2 = evaluate(docs({ 'architecture/stakeholders.md': shChecklist, 'architecture/CHECKLIST.md': checklist }), criteria, {});
  assert.equal(r2.registers[0].criteria[0].status, 'ok');
});

test('glossary.kinds: every kind used in generated.c4 needs a glossary term', () => {
  const criteria = { 'glossary.md': [{ id: 'glossary.kinds', check: 'join', rule: 'x' }] };
  const c4 = "model {\n  system sys 'Sys' {\n    service comp_a 'A' {\n      technology '3 files'\n    }\n    cli comp_b 'B' {\n      technology '1 files'\n    }\n  }\n}\n";
  const missing = evaluate(docs({ 'architecture/glossary.md': '| term | meaning |\n|---|---|\n', 'architecture/model/generated.c4': c4 }), criteria, {});
  assert.equal(missing.registers[0].criteria[0].status, 'fail');
  assert.deepEqual(missing.registers[0].criteria[0].detail.sort(), ['cli', 'service']);

  const glossary = '| term | meaning |\n|---|---|\n| Service | a component kind |\n| CLI | a component kind |\n';
  const ok = evaluate(docs({ 'architecture/glossary.md': glossary, 'architecture/model/generated.c4': c4 }), criteria, {});
  assert.equal(ok.registers[0].criteria[0].status, 'ok');
});

test('glossary.mapped: every glossary row must cite a path, ADR, or symbol in its last column', () => {
  const criteria = { 'glossary.md': [{ id: 'glossary.mapped', check: 'join', rule: 'x' }] };
  const bad = '| term | meaning | maps to |\n|---|---|---|\n| Kernel | the core | somewhere vague |\n';
  const r = evaluate(docs({ 'architecture/glossary.md': bad }), criteria, {});
  assert.equal(r.registers[0].criteria[0].status, 'fail');
  assert.deepEqual(r.registers[0].criteria[0].detail, ['Kernel']);

  const good = '| term | meaning | maps to |\n|---|---|---|\n| Kernel | the core | scripts/arch/kernel.mjs |\n| Flow | a run | ADR 005 |\n';
  const ok = evaluate(docs({ 'architecture/glossary.md': good }), criteria, {});
  assert.equal(ok.registers[0].criteria[0].status, 'ok');
});

test('signals.emitters: every secret-like env var must appear in signals.md or secrets.md', () => {
  const criteria = { 'signals.md': [{ id: 'signals.emitters', check: 'join', rule: 'x' }] };
  const env = JSON.stringify({ secretLike: ['API_KEY'] });
  const missing = evaluate(docs({ 'architecture/signals.md': 'no mention here\n', 'reference/env.json': env }), criteria, {});
  assert.equal(missing.registers[0].criteria[0].status, 'fail');
  assert.deepEqual(missing.registers[0].criteria[0].detail, ['API_KEY']);

  const okViaSignals = evaluate(docs({ 'architecture/signals.md': 'emits API_KEY on boot\n', 'reference/env.json': env }), criteria, {});
  assert.equal(okViaSignals.registers[0].criteria[0].status, 'ok');

  const okViaSecrets = evaluate(docs({ 'architecture/signals.md': 'no mention\n', 'architecture/secrets.md': 'API_KEY lives in the vault\n', 'reference/env.json': env }), criteria, {});
  assert.equal(okViaSecrets.registers[0].criteria[0].status, 'ok');
});

test('signals.risk-triggers: agent with no trigger column; fails on an empty trigger cell; ok when all are filled', () => {
  const criteria = { 'signals.md': [{ id: 'signals.risk-triggers', check: 'join', rule: 'x' }] };
  const noColumn = evaluate(docs({ 'architecture/signals.md': 'x\n', 'architecture/risks.md': '| likelihood |\n|---|\n| high |\n' }), criteria, {});
  assert.equal(noColumn.registers[0].criteria[0].status, 'agent');

  const empty = evaluate(docs({ 'architecture/signals.md': 'x\n', 'architecture/risks.md': '| id | trigger |\n|---|---|\n| r1 | X happens |\n| r2 |  |\n' }), criteria, {});
  assert.equal(empty.registers[0].criteria[0].status, 'fail');
  assert.deepEqual(empty.registers[0].criteria[0].detail, ['r2']);

  const filled = evaluate(docs({ 'architecture/signals.md': 'x\n', 'architecture/risks.md': '| id | trigger |\n|---|---|\n| r1 | X happens |\n' }), criteria, {});
  assert.equal(filled.registers[0].criteria[0].status, 'ok');
});

test('scenarios.minimum is mechanical once opts.minScenarios is given; scenarios.gates stays agent', () => {
  const criteria = { scenarios: [{ id: 'scenarios.minimum', check: 'join', rule: 'x' }, { id: 'scenarios.gates', check: 'join', rule: 'x' }] };
  const oneScenario = docs({ 'architecture/scenarios/happy-path.md': '# scenario\n' });

  const skipped = evaluate(oneScenario, criteria, {});
  assert.equal(skipped.registers[0].criteria[0].status, 'agent');
  assert.equal(skipped.registers[0].criteria[1].status, 'agent');

  const tooFew = evaluate(oneScenario, criteria, { minScenarios: 2 });
  assert.equal(tooFew.registers[0].criteria[0].status, 'fail');
  assert.equal(tooFew.registers[0].criteria[1].status, 'agent'); // gates is never made mechanical

  const enough = evaluate(oneScenario, criteria, { minScenarios: 1 });
  assert.equal(enough.registers[0].criteria[0].status, 'ok');
});

test('verdict is fail when anything fails, unknown when nothing fails but something is unevaluated, ok otherwise', () => {
  const allOk = evaluate(docs({ 'architecture/risks.md': 'reviewed: 2026-09-01\n\n| likelihood | impact | trigger | mitigation | owner |\n|---|---|---|---|---|\n' }), { 'risks.md': [{ id: 'risks.row-schema', check: 'schema', rule: 'x' }] }, {});
  assert.equal(allOk.unknown, 0);
  assert.equal(allOk.verdict, 'ok');

  const unevaluated = evaluate(docs({ 'architecture/risks.md': 'x\n' }), { 'risks.md': [{ id: 'risks.incidents', check: 'agent', rule: 'x' }] }, {});
  assert.equal(unevaluated.failing, 0);
  assert.equal(unevaluated.unknown, 1);
  assert.equal(unevaluated.verdict, 'unknown'); // never presented as pass

  const failed = evaluate(docs({}), { 'risks.md': [{ id: 'risks.row-schema', check: 'schema', rule: 'x' }] }, {});
  assert.equal(failed.verdict, 'fail');
});
