import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefMd } from './brief.mjs';

const BASE = {
  sys: { id: 'sys', title: 'Acme' },
  kinds: { kinds: ['service'], evidence: ['containerised'], ambiguous: false },
  components: {
    nodes: [{ id: 'core', files: 5 }, { id: 'webui', files: 3 }],
    edges: [{ from: 'webui', to: 'core', count: 2 }],
    cycles: [],
    engine: 'builtin',
  },
  rules: { kinds: { webui: 'webui' }, descriptions: { core: 'the business logic' }, areas: { front: ['webui'] } },
  drift: { unexplained: 0, edges: { undeclared: [], inHandNotCode: [] } },
  baseline: { edges: [] },
  fitness: { ok: true, results: [] },
  completeness: { registers: [] },
  handEdges: [{ from: 'webui', to: 'core', runtime: false }],
  gaps: [],
  sha: 'deadbee',
};

test('briefMd is pure and deterministic given the same inputs', () => {
  assert.equal(briefMd(BASE), briefMd(BASE));
});

test('briefMd works with no inputs at all', () => {
  const md = briefMd();
  assert.match(md, /# Stage-2 brief/);
  assert.match(md, /## 1\. What this project is/);
  assert.match(md, /## 8\. Commands stage 2 may run/);
});

test('section 1: kinds, evidence, component table with kind/description/edge counts, cycles', () => {
  const md = briefMd(BASE);
  assert.match(md, /kind\(s\): service/);
  assert.match(md, /classification evidence: containerised/);
  assert.match(md, /\| core \| service \| the business logic \| 5 \| 0 out \/ 1 in \|/);
  assert.match(md, /\| webui \| webui \|  \| 3 \| 1 out \/ 0 in \|/);
  assert.match(md, /No import cycles\./);
  const withCycle = briefMd({ ...BASE, components: { ...BASE.components, cycles: [{ a: 'core', b: 'webui', ab: 2, ba: 1 }] } });
  assert.match(withCycle, /Import cycles: core<->webui \(2\/1\)\./);
});

test('section 2: drift summary reports undeclared, claimed-but-absent and baseline size', () => {
  const md = briefMd({
    ...BASE,
    drift: { unexplained: 2, edges: { undeclared: [{ from: 'a', to: 'b' }], inHandNotCode: [{ from: 'c', to: 'd' }] } },
    baseline: { edges: [{ from: 'x', to: 'y' }] },
  });
  assert.match(md, /unexplained: 2 \(undeclared in hand\.c4: 1, claimed-but-absent in code: 1\) · baseline size: 1/);
  assert.match(md, /Undeclared \(in code, not in hand\.c4\): a->b\./);
  assert.match(md, /Claimed-but-absent \(in hand\.c4, not in code\): c->d\./);
});

test('section 3: a clean fitness report says so, with no rule sections', () => {
  const md = briefMd(BASE);
  assert.match(md, /## 3\. Failing fitness rules — fix recipes\n\nNone — `arch check` is green\./);
});

test('section 3: docs.checklist-complete recipe routes a reference/ view to its underlying gap, a written view to a file+shape, and adrs to the source root', () => {
  const md = briefMd({
    ...BASE,
    fitness: { ok: false, results: [{ id: 'docs.checklist-complete', ok: false, detail: ['api', 'risks', 'adrs'] }] },
  });
  assert.match(md, /api -> `reference\/api\.md` is generated from extractor data, not hand-written/);
  assert.match(md, /risks -> write `architecture\/risks\.md` with a table with columns: likelihood, impact, trigger, mitigation, owner\./);
  assert.match(md, /adrs -> a real decision belongs at `<source root>\/docs\/decisions\/NNN-title\.md`/);
});

test('section 3: every DEFAULT_RULES id has a specific recipe, not the generic fallback', () => {
  const ids = ['docs.size-cap', 'docs.reference-generated', 'docs.no-blank-checklist', 'naming.retired', 'docs.cited-paths-exist', 'docs.cell-length', 'docs.view-shape', 'docs.source-sha'];
  const md = briefMd({
    ...BASE,
    fitness: { ok: false, results: ids.map(id => ({ id, ok: false, detail: [id === 'docs.size-cap' ? 'overview.md 450' : 'architecture/overview.md'] })) },
  });
  assert.doesNotMatch(md, /see reference\/fitness\.json/);
  assert.match(md, /split or cut `overview\.md` \(450 lines\)/);
  assert.match(md, /```mermaid/);
});

test('section 3: an unrecognised rule id falls back to quoting its detail verbatim', () => {
  const md = briefMd({ ...BASE, fitness: { ok: false, results: [{ id: 'some.future-rule', ok: false, detail: ['thing-one', 'thing-two'] }] } });
  assert.match(md, /offending: thing-one, thing-two\./);
});

test('section 3: a rule with no detail at all still gets a fallback line, not a crash', () => {
  const md = briefMd({ ...BASE, fitness: { ok: false, results: [{ id: 'some.future-rule', ok: false, detail: [] }] } });
  assert.match(md, /offending: see reference\/fitness\.json\./);
});

test('section 4: completeness failures get a recipe; agent-status criteria go to the judgement list, not a recipe', () => {
  const md = briefMd({
    ...BASE,
    completeness: {
      registers: [
        { file: 'risks.md', criteria: [{ id: 'risks.row-schema', status: 'fail', detail: ['row1'] }, { id: 'risks.incidents', status: 'agent', detail: [] }] },
        { file: 'deps.md', criteria: [{ id: 'deps.why', status: 'ok', detail: [] }] },
      ],
    },
  });
  assert.match(md, /### `risks\.md` · `risks\.row-schema`/);
  assert.match(md, /fill every risks\.md row's likelihood, impact, trigger, mitigation and owner cell; offending rows: row1\./);
  assert.match(md, /Left to reviewer judgement \(check type `agent`, not a failure — no recipe applies\):\n`risks\.md`\/`risks\.incidents`/);
  assert.doesNotMatch(md, /### `deps\.md`/, 'a passing criterion gets no section');
});

test('section 4: a register whose file does not exist yet gets one grouped line, not a fabricated per-criterion recipe', () => {
  const md = briefMd({
    ...BASE,
    completeness: {
      registers: [{ file: 'risks.md', criteria: [{ id: 'risks.row-schema', status: 'missing', detail: [] }, { id: 'risks.reviewed', status: 'missing', detail: [] }] }],
    },
  });
  assert.match(md, /### `risks\.md` — does not exist yet/);
  assert.match(md, /Write it first \(see section 5's `where` column\) — every criterion below applies once it does: `risks\.row-schema`, `risks\.reviewed`\./);
  assert.doesNotMatch(md, /missing: \.\s*$/m, 'never emit an empty "missing: ." line');
});

test('section 4: no failures at all is stated plainly', () => {
  assert.match(briefMd(BASE), /## 4\. Completeness failures — fix recipes\n\nNone failing\./);
});

test('section 4: an unrecognised completeness criterion id falls back to quoting its detail', () => {
  const md = briefMd({ ...BASE, completeness: { registers: [{ file: 'x.md', criteria: [{ id: 'x.future', status: 'fail', detail: ['a', 'b'] }] }] } });
  assert.match(md, /offending: a, b\./);
});

test('section 5: required-view rows come from checklist.mjs, one per ✓-required view for this kind', () => {
  const md = briefMd(BASE);
  assert.match(md, /\| risks \| architecture\/risks\.md \| columns: likelihood, impact, trigger, mitigation, owner \|/);
  assert.match(md, /\| pipeline \| reference\/delivery\.md \|/);
  assert.doesNotMatch(md, /\| loop \|/, 'loop is not required for a service kind');
});

test('section 6: seeded hand.c4 edges and configured areas are both listed', () => {
  const md = briefMd(BASE);
  assert.match(md, /Currently declared edges: webui->core\./);
  assert.match(md, /Area groups \(fold-rules\.json `areas`\): front\./);
  const none = briefMd({ ...BASE, handEdges: [], rules: {} });
  assert.match(none, /Currently declared edges: \(none\)\./);
  assert.match(none, /Area groups \(fold-rules\.json `areas`\): none configured/);
});

test('section 7: gaps are counted and listed by class', () => {
  const md = briefMd({ ...BASE, gaps: [{ id: 'g1', class: 'kit' }, { id: 'g2', class: 'project' }, { id: 'g3', class: 'human' }, { id: 'g4', class: 'human' }] });
  assert.match(md, /\*\*kit\*\* \(1\): `g1`\./);
  assert.match(md, /\*\*project\*\* \(1\): `g2`\./);
  assert.match(md, /\*\*human\*\* \(2\): `g3`, `g4`\./);
});

test('section 8: the fixed command list names every allowed command and the "do not read source" line', () => {
  const md = briefMd(BASE);
  assert.match(md, /arch run <root> --out <docsDir> --no-render --now <date>/);
  assert.match(md, /arch guard verify/);
  assert.match(md, /arch guard close/);
  assert.match(md, /Do not read the kit's source/);
});

test('table cells are truncated to 220 characters, so no cell can trip the cell-length fitness rule', () => {
  const long = 'x'.repeat(500);
  const md = briefMd({ ...BASE, rules: { descriptions: { core: long } } });
  for (const line of md.split('\n')) {
    if (!/^\|.*\|$/.test(line) || /^\|[-\s|]+\|$/.test(line)) continue; // a real row, not a separator
    for (const c of line.trim().slice(1, -1).split('|')) assert.ok(c.trim().length <= 220, `cell too long: ${c.slice(0, 40)}...`);
  }
});

test('the header carries the generated marker and the given sha', () => {
  const md = briefMd(BASE);
  assert.match(md, /^generated by arch run\nsource: deadbee\n/);
});

test('section 3: the deployment recipe offers the rendered route (a deployment block + deployment view in hand.c4) as well as deployment.md', () => {
  const md = briefMd({ ...BASE, fitness: { ok: false, results: [{ id: 'docs.checklist-complete', ok: false, detail: ['deployment'] }] } });
  assert.match(md, /deployment \{/);
  assert.match(md, /deployment view deployment/);
  assert.match(md, /architecture\/deployment\.md/);
});

test('section 5 leads with overview.md for every kind: it is the written document the house style requires of every archetype', () => {
  for (const kinds of [['service'], ['iac'], ['cli']]) {
    const md = briefMd({ ...BASE, kinds: { kinds, evidence: [], ambiguous: false } });
    const section = md.slice(md.indexOf('## 5.'), md.indexOf('## 6.'));
    const rows = section.split('\n').filter(l => /^\| [a-z]/.test(l) && !/^\| view \|/.test(l));
    assert.match(rows[0], /^\| overview \| architecture\/overview\.md \| prose/, `${kinds}: first row`);
  }
});
