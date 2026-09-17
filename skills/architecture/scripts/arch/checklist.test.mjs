import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredViews, checklistMd, VIEWS, viewShape, presentFromViews } from './checklist.mjs';
import { check } from './check.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('every archetype requires the six base views', () => {
  for (const kind of ['cli', 'service', 'iac', 'plugin', 'simulation', 'hardware', 'pipeline', 'extension']) {
    const rows = requiredViews([kind]);
    for (const v of ['context', 'component', 'pipeline', 'deps', 'adrs', 'rules']) {
      assert.equal(rows.find(r => r.view === v).required, '✓', `${kind}/${v}`);
    }
  }
});

test('service adds its named views as required, including screen-flow as a UI kind', () => {
  const rows = requiredViews(['service']);
  for (const v of ['deployment', 'scenarios', 'api', 'credential', 'signals', 'tests', 'risks', 'stakeholders', 'screen-flow']) {
    assert.equal(rows.find(r => r.view === v).required, '✓', v);
  }
  assert.equal(rows.find(r => r.view === 'catalogue').required, 'opt', 'catalogue stays optional until a schema extractor exists');
  assert.equal(rows.find(r => r.view === 'module-graph').required, '—');
});

test('iac adds module graph, credential flow, risks; leaves screen-flow n/a', () => {
  const rows = requiredViews(['iac']);
  assert.equal(rows.find(r => r.view === 'module-graph').required, '✓');
  assert.equal(rows.find(r => r.view === 'credential').required, '✓');
  assert.equal(rows.find(r => r.view === 'risks').required, '✓');
  assert.equal(rows.find(r => r.view === 'screen-flow').required, '—');
});

test('simulation and hardware both require the tick loop; only hardware requires device topology', () => {
  assert.equal(requiredViews(['simulation']).find(r => r.view === 'loop').required, '✓');
  assert.equal(requiredViews(['hardware']).find(r => r.view === 'loop').required, '✓');
  assert.equal(requiredViews(['simulation']).find(r => r.view === 'device-topology').required, '—');
  assert.equal(requiredViews(['hardware']).find(r => r.view === 'device-topology').required, '✓');
});

test('pipeline requires the job DAG and data contracts', () => {
  const rows = requiredViews(['pipeline']);
  assert.equal(rows.find(r => r.view === 'job-dag').required, '✓');
  assert.equal(rows.find(r => r.view === 'data-contracts').required, '✓');
});

test('union across ambiguous kinds takes the max requirement level', () => {
  const rows = requiredViews(['iac', 'cli']);
  assert.equal(rows.find(r => r.view === 'module-graph').required, '✓'); // from iac
  assert.equal(rows.find(r => r.view === 'api').required, '✓'); // from cli
  assert.equal(rows.find(r => r.view === 'credential').required, '✓'); // iac ✓ beats cli opt
});

test('unknown or empty kinds fall back to just the base six', () => {
  const rows = requiredViews([]);
  assert.equal(rows.filter(r => r.required === '✓').length, 6);
});

test('checklistMd renders MISSING for required-but-absent, n/a with reason otherwise, and never a blank cell', () => {
  const md = checklistMd(['cli'], { context: true, component: 'partial' });
  assert.match(md, /\| context \| ✓ \|  \|/);
  assert.match(md, /\| component \| partial \|  \|/);
  assert.match(md, /\| pipeline \| MISSING \|  \|/); // required, absent
  assert.match(md, /\| deployment \| n\/a: no deployment target beyond source control \|  \|/); // not applicable
  assert.match(md, /\| credential \| n\/a: optional for this kind \|  \|/); // opt, absent
  for (const line of dataRows(md)) {
    assert.match(line, /(✓|partial|n\/a:\s*\S|MISSING)/, line);
  }
});

function dataRows(md) {
  return md.split('\n').filter(l => /^\|/.test(l) && !/^\|-+\|/.test(l) && !/^\| view \|/.test(l));
}

test('a string present value marks the view present and fills the where column', () => {
  const md = checklistMd(['cli'], { api: 'docs/reference/api.md' });
  assert.match(md, /\| api \| ✓ \| docs\/reference\/api\.md \|/);
});

test('checklistMd output covers every declared view exactly once', () => {
  const md = checklistMd(['service']);
  assert.equal(dataRows(md).length, VIEWS.length);
});

function docs(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

test('checklistMd output satisfies arch check\'s no-blank-checklist rule once required views are marked present', () => {
  const present = Object.fromEntries(requiredViews(['service']).filter(r => r.required === '✓').map(r => [r.view, true]));
  const md = checklistMd(['service'], present);
  const root = docs({ 'architecture/CHECKLIST.md': md });
  const r = check(root);
  assert.equal(r.results.find(x => x.id === 'docs.no-blank-checklist').ok, true);
});

test('quality is required for service, iac, pipeline, hardware and optional for every other kind', () => {
  for (const kind of ['service', 'iac', 'pipeline', 'hardware']) {
    assert.equal(requiredViews([kind]).find(r => r.view === 'quality').required, '✓', kind);
  }
  for (const kind of ['cli', 'plugin', 'simulation', 'extension', 'library']) {
    assert.equal(requiredViews([kind]).find(r => r.view === 'quality').required, 'opt', kind);
  }
});

test('viewShape describes loop, signals, credential, screen-flow, and module-graph as needing a mermaid fence or svg', () => {
  for (const view of ['loop', 'signals', 'credential', 'screen-flow', 'module-graph']) {
    assert.equal(viewShape(view).needsFence, true, view);
  }
});

test('viewShape gives risks its five required row columns', () => {
  assert.deepEqual(viewShape('risks').needsTableColumns, ['likelihood', 'impact', 'trigger', 'mitigation', 'owner']);
});

test('viewShape gives quality its three required row columns', () => {
  assert.deepEqual(viewShape('quality').needsTableColumns, ['goal', 'scenario', 'rule']);
  assert.equal(viewShape('quality').file, 'architecture/quality.md');
});

test('viewShape returns a shape for every declared view, and an unopinionated default for an unknown one', () => {
  for (const view of VIEWS) {
    const s = viewShape(view);
    assert.ok(s && typeof s.file !== 'undefined' && typeof s.needsFence === 'boolean' && Array.isArray(s.needsTableColumns), view);
  }
  assert.deepEqual(viewShape('not-a-real-view'), { file: null, needsFence: false, needsTableColumns: [] });
});

test('viewShape returns a fresh array each call so a caller cannot mutate the shared shape', () => {
  const a = viewShape('risks');
  a.needsTableColumns.push('extra');
  assert.deepEqual(viewShape('risks').needsTableColumns, ['likelihood', 'impact', 'trigger', 'mitigation', 'owner']);
});

test('a fully-missing checklist is explicit (no blank rows) but fails checklist-complete', () => {
  const md = checklistMd(['service']);
  const root = docs({ 'architecture/CHECKLIST.md': md });
  const r = check(root);
  assert.equal(r.results.find(x => x.id === 'docs.no-blank-checklist').ok, true);
  assert.equal(r.results.find(x => x.id === 'docs.checklist-complete').ok, false);
});

test('the job-dag view is present once reference/jobs.md carries the jobs table', () => {
  const s = viewShape('job-dag');
  assert.equal(s.file, 'reference/jobs.md');
  assert.equal(s.needsFence, false);
  assert.deepEqual(s.needsTableColumns, ['source', 'file', 'job', 'schedule']);
});

test('presentFromViews maps rendered PNGs to the views they satisfy: index.png is context, deployment.png is deployment', () => {
  assert.deepEqual(presentFromViews(['containers.png', 'deployment.png', 'index.png']), { context: 'reference/views/index.png', deployment: 'reference/views/deployment.png' });
  assert.deepEqual(presentFromViews(['containers.png']), {});
  assert.deepEqual(presentFromViews([]), {});
});
