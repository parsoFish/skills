import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGaps, interviewMd, kitIssuesMd, projectChangesMd, loadAnswers, reconcileProjectChanges } from './interview.mjs';

test('kind-ambiguous classify produces a human gap with one option per kind', () => {
  const gaps = buildGaps({ classify: { kinds: ['cli', 'service'], ambiguous: true, evidence: ['bin + web framework'] } });
  const g = gaps.find(x => x.id === 'kind-ambiguous');
  assert.equal(g.class, 'human');
  assert.deepEqual(g.options, ['treat as cli', 'treat as service']);
  assert.equal(g.default, 'treat as cli');
});

test('import cycles become one human gap per cycle with the standard options', () => {
  const gaps = buildGaps({ components: { cycles: [{ a: 'agents', b: 'flows', ab: 3, ba: 2 }] } });
  const g = gaps.find(x => x.id === 'import-cycle-agents-flows');
  assert.equal(g.class, 'human');
  assert.deepEqual(g.options, ['accept-by-ADR', 'split-light', 'split-all']);
  assert.equal(g.default, 'accept-by-ADR');
});

test('drift.unexplained produces one human gap per edge with fix/tag/ADR options, default fix', () => {
  const gaps = buildGaps({ drift: { edges: { inHandNotCode: [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }] } } });
  const ids = gaps.map(g => g.id);
  assert.ok(ids.includes('drift-unexplained-a-b'));
  assert.ok(ids.includes('drift-unexplained-c-d'));
  const g = gaps.find(x => x.id === 'drift-unexplained-a-b');
  assert.equal(g.default, 'fix hand model');
});

test('unused deps become project-class gaps, one per dependency', () => {
  const gaps = buildGaps({ deps: { items: [{ name: 'left-pad', unused: true, why: 'x' }, { name: 'lodash', unused: false, why: 'x' }] } });
  assert.deepEqual(gaps.map(g => g.id), ['deps-unused-left-pad']);
  assert.equal(gaps[0].class, 'project');
});

test('missing-why deps become a single human gap listing every name', () => {
  const gaps = buildGaps({ deps: { items: [{ name: 'a', why: '' }, { name: 'b', why: null }, { name: 'c', why: 'ok' }] } });
  const g = gaps.find(x => x.id === 'deps-missing-why');
  assert.equal(g.class, 'human');
  assert.match(g.finding, /a, b/);
  assert.ok(!g.finding.includes(', c'));
});

test('api literals source is a project gap', () => {
  const gaps = buildGaps({ api: { source: 'literals' } });
  assert.equal(gaps[0].class, 'project');
  assert.equal(gaps[0].id, 'api-source-literals');
});

test('delivery.requiredChecks null is a kit gap; undefined delivery raises nothing', () => {
  assert.equal(buildGaps({ delivery: { requiredChecks: null } })[0].class, 'kit');
  assert.deepEqual(buildGaps({}), []);
  assert.deepEqual(buildGaps({ delivery: { requiredChecks: ['ci'] } }), []);
});

test('delivery.requiredChecks null offers the real remedy (an answers.json entry), never the nonexistent --github flag', () => {
  const g = buildGaps({ delivery: { requiredChecks: null } })[0];
  assert.deepEqual(g.options, ['set delivery.requiredChecks in docs/architecture/answers.json']);
  assert.equal(g.default, 'set delivery.requiredChecks in docs/architecture/answers.json');
  assert.ok(!g.finding.includes('--github'));
  assert.ok(!g.options.join(' ').includes('--github'));
});

test('tests.taggingAdopted false is a project gap', () => {
  const gaps = buildGaps({ tests: { taggingAdopted: false } });
  assert.equal(gaps[0].class, 'project');
});

test('env secretLike names produce a project gap listing the names', () => {
  const gaps = buildGaps({ env: { secretLike: ['API_KEY', 'DB_PASSWORD'] } });
  assert.match(gaps[0].finding, /API_KEY, DB_PASSWORD/);
  assert.equal(gaps[0].class, 'project');
});

test('completeness fail criteria become one human gap per (register, criterion)', () => {
  const completeness = { registers: [{ file: 'risks.md', criteria: [{ id: 'risks.row-schema', status: 'fail', detail: ['row X'] }, { id: 'risks.reviewed', status: 'ok', detail: [] }] }] };
  const gaps = buildGaps({ completeness });
  assert.deepEqual(gaps.map(g => g.id), ['completeness-risks.md-risks.row-schema']);
  assert.equal(gaps[0].class, 'human');
});

test('interviewMd numbers only unanswered human gaps in the fixed question shape', () => {
  const gaps = buildGaps({ classify: { kinds: ['cli', 'service'], ambiguous: true, evidence: ['e'] }, api: { source: 'literals' } });
  const md = interviewMd(gaps, {});
  assert.match(md, /### Q1 · Which archetype is this project\?   id: kind-ambiguous/);
  assert.match(md, /Finding\. /);
  assert.match(md, /Evidence\. e/);
  assert.match(md, /Options\. \(a\) treat as cli · \(b\) treat as service/);
  assert.match(md, /Default\. treat as cli/);
  assert.match(md, /Changes\. /);
  assert.ok(!md.includes('api-source-literals')); // project-class, not a question
});

test('interviewMd skips gaps already present in answers', () => {
  const gaps = buildGaps({ classify: { kinds: ['cli', 'service'], ambiguous: true, evidence: ['e'] } });
  const md = interviewMd(gaps, { 'kind-ambiguous': { answer: 'cli', at: '2026-09-12' } });
  assert.ok(!md.includes('kind-ambiguous'));
});

test('kitIssuesMd lists kit gaps with a repro line; projectChangesMd lists project gaps with changes', () => {
  const gaps = buildGaps({ delivery: { requiredChecks: null }, api: { source: 'literals' } });
  const kit = kitIssuesMd(gaps);
  assert.match(kit, /## Delivery extractor could not read required checks/);
  assert.match(kit, /repro: /);
  const proj = projectChangesMd(gaps);
  assert.match(proj, /## API surface has no schema/);
  assert.match(proj, /changes: docs\/reference\/api\.md/);
});

test('reconcileProjectChanges: a gap never seen before is "new"', () => {
  const gaps = [{ id: 'deps-unused-left-pad', class: 'project' }];
  const out = reconcileProjectChanges([], gaps, '2026-09-12');
  assert.deepEqual(out, [{ id: 'deps-unused-left-pad', status: 'new', firstSeen: '2026-09-12', lastSeen: '2026-09-12' }]);
});

test('reconcileProjectChanges: a gap seen again (new or open) becomes "open" and keeps its firstSeen', () => {
  const prev = [{ id: 'deps-unused-left-pad', status: 'new', firstSeen: '2026-09-01', lastSeen: '2026-09-01' }];
  const gaps = [{ id: 'deps-unused-left-pad', class: 'project' }];
  const out = reconcileProjectChanges(prev, gaps, '2026-09-12');
  assert.deepEqual(out, [{ id: 'deps-unused-left-pad', status: 'open', firstSeen: '2026-09-01', lastSeen: '2026-09-12' }]);
});

test('reconcileProjectChanges: a gap that disappears becomes "resolved" and is kept, not dropped', () => {
  const prev = [{ id: 'deps-unused-left-pad', status: 'open', firstSeen: '2026-09-01', lastSeen: '2026-09-10' }];
  const out = reconcileProjectChanges(prev, [], '2026-09-12');
  assert.deepEqual(out, [{ id: 'deps-unused-left-pad', status: 'resolved', firstSeen: '2026-09-01', lastSeen: '2026-09-10' }]);
});

test('reconcileProjectChanges: a resolved gap that comes back is "regressed", then "open" the run after', () => {
  const resolved = [{ id: 'deps-unused-left-pad', status: 'resolved', firstSeen: '2026-09-01', lastSeen: '2026-09-05' }];
  const gaps = [{ id: 'deps-unused-left-pad', class: 'project' }];
  const regressed = reconcileProjectChanges(resolved, gaps, '2026-09-12');
  assert.deepEqual(regressed, [{ id: 'deps-unused-left-pad', status: 'regressed', firstSeen: '2026-09-01', lastSeen: '2026-09-12' }]);

  const stillPresent = reconcileProjectChanges(regressed, gaps, '2026-09-13');
  assert.deepEqual(stillPresent, [{ id: 'deps-unused-left-pad', status: 'open', firstSeen: '2026-09-01', lastSeen: '2026-09-13' }]);
});

test('reconcileProjectChanges: an already-resolved gap that stays absent is left untouched', () => {
  const prev = [{ id: 'deps-unused-left-pad', status: 'resolved', firstSeen: '2026-09-01', lastSeen: '2026-09-05' }];
  const out = reconcileProjectChanges(prev, [], '2026-09-12');
  assert.deepEqual(out, prev);
});

test('reconcileProjectChanges ignores non-project-class gaps and sorts by id', () => {
  const gaps = [{ id: 'b-gap', class: 'project' }, { id: 'a-gap', class: 'project' }, { id: 'kind-ambiguous', class: 'human' }];
  const out = reconcileProjectChanges([], gaps, '2026-09-12');
  assert.deepEqual(out.map(c => c.id), ['a-gap', 'b-gap']);
});

test('projectChangesMd renders a status column when reconciled changes are passed, and omits it otherwise', () => {
  const gaps = buildGaps({ delivery: { requiredChecks: null }, api: { source: 'literals' } });
  const changes = [{ id: 'api-source-literals', status: 'regressed', firstSeen: '2026-08-01', lastSeen: '2026-09-12' }];
  const withStatus = projectChangesMd(gaps, changes);
  assert.match(withStatus, /status: regressed \(first seen: 2026-08-01, last seen: 2026-09-12\)/);

  const withoutStatus = projectChangesMd(gaps);
  assert.ok(!withoutStatus.includes('status:'));
});

test('loadAnswers returns {} when the file is missing, and parses JSON when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'answers-'));
  assert.deepEqual(loadAnswers(join(dir, 'nope.json')), {});
  const p = join(dir, 'answers.json');
  writeFileSync(p, JSON.stringify({ 'kind-ambiguous': { answer: 'cli', at: '2026-09-12' } }));
  assert.deepEqual(loadAnswers(p), { 'kind-ambiguous': { answer: 'cli', at: '2026-09-12' } });
});
