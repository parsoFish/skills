import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drift, jaccard, writeBaselineProposal, shrinkBaseline } from './drift.mjs';

const code = { nodes: [{ id: 'flows' }, { id: 'agents' }, { id: 'kernel' }], edges: [{ from: 'flows', to: 'agents', count: 19 }, { from: 'agents', to: 'kernel', count: 24 }] };

test('claimed edge missing in code is unexplained; an undeclared code edge is unexplained too (no fail-open); runtime edges are skipped', () => {
  const hand = { nodes: code.nodes, edges: [{ from: 'flows', to: 'agents' }, { from: 'agents', to: 'flows' }, { from: 'studio', to: 'bridge', runtime: true }] };
  const d = drift(hand, code);
  assert.deepEqual(d.edges.inHandNotCode, [{ from: 'agents', to: 'flows' }]);
  assert.equal(d.edges.skippedRuntime, 1);
  assert.deepEqual(d.edges.inCodeNotHand, [{ from: 'agents', to: 'kernel', count: 24 }]);
  assert.deepEqual(d.edges.undeclared, [{ from: 'agents', to: 'kernel', count: 24 }]);
  assert.equal(d.unexplained, 2); // 1 hand-not-code + 1 undeclared code edge
});

test('a baseline shrinks the undeclared set: baselined edges no longer count toward unexplained', () => {
  const hand = { nodes: code.nodes, edges: [{ from: 'flows', to: 'agents' }] };
  const d = drift(hand, code, { baseline: { edges: ['agents kernel'] } });
  assert.deepEqual(d.edges.undeclared, []);
  assert.equal(d.unexplained, 0);
});

test('baselineStale lists baseline entries the code no longer shows', () => {
  const hand = { nodes: code.nodes, edges: [] };
  const d = drift(hand, code, { baseline: { edges: ['agents kernel', 'flows kernel'] } });
  assert.deepEqual(d.edges.baselineStale, ['flows kernel']);
  assert.deepEqual(d.edges.undeclared, [{ from: 'flows', to: 'agents', count: 19 }]);
});

test('writeBaselineProposal captures every currently-undeclared code edge for a first run to save', () => {
  const hand = { nodes: code.nodes, edges: [] };
  const d = drift(hand, code);
  assert.deepEqual(writeBaselineProposal(d), { edges: ['agents kernel', 'flows agents'] });
});

test('shrinkBaseline only removes stale entries, never adds', () => {
  const hand = { nodes: code.nodes, edges: [] };
  const d = drift(hand, code, { baseline: { edges: ['agents kernel', 'flows kernel'] } });
  const shrunk = shrinkBaseline({ edges: ['agents kernel', 'flows kernel'] }, d);
  assert.deepEqual(shrunk, { edges: ['agents kernel'] });
});

test('renames detected by token similarity', () => {
  const hand = { nodes: [{ id: 'flow-engine' }, { id: 'agents' }, { id: 'kernel' }], edges: [] };
  const d = drift(hand, { ...code, nodes: [{ id: 'flow_engine' }, { id: 'agents' }, { id: 'kernel' }] }, { baseline: writeBaselineProposal(drift(hand, code)) });
  assert.deepEqual(d.nodes.renamed.map(r => [r.from, r.to]), [['flow-engine', 'flow_engine']]);
  assert.deepEqual(d.nodes.added, []); assert.deepEqual(d.nodes.removed, []);
});

test('internal scope drops externals from the comparison', () => {
  const hand = { nodes: [], edges: [{ from: 'agents', to: 'github' }] };
  const d = drift(hand, code, { internal: new Set(['flows', 'agents', 'kernel']) });
  assert.equal(d.edges.inHandNotCode.length, 0);
});

test('jaccard basics', () => { assert.equal(jaccard('a b', 'a b'), 1); assert.equal(jaccard('a', 'b'), 0); });
