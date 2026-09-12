import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drift, jaccard } from './drift.mjs';

const code = { nodes: [{ id: 'flows' }, { id: 'agents' }, { id: 'kernel' }], edges: [{ from: 'flows', to: 'agents', count: 19 }, { from: 'agents', to: 'kernel', count: 24 }] };

test('claimed edge missing in code is unexplained; runtime edges are skipped', () => {
  const hand = { nodes: code.nodes, edges: [{ from: 'flows', to: 'agents' }, { from: 'agents', to: 'flows' }, { from: 'studio', to: 'bridge', runtime: true }] };
  const d = drift(hand, code);
  assert.deepEqual(d.edges.inHandNotCode, [{ from: 'agents', to: 'flows' }]);
  assert.equal(d.edges.skippedRuntime, 1);
  assert.equal(d.unexplained, 1);
  assert.deepEqual(d.edges.inCodeNotHand, [{ from: 'agents', to: 'kernel', count: 24 }]);
});

test('renames detected by token similarity', () => {
  const hand = { nodes: [{ id: 'flow-engine' }, { id: 'agents' }, { id: 'kernel' }], edges: [] };
  const d = drift(hand, { ...code, nodes: [{ id: 'flow_engine' }, { id: 'agents' }, { id: 'kernel' }] });
  assert.deepEqual(d.nodes.renamed.map(r => [r.from, r.to]), [['flow-engine', 'flow_engine']]);
  assert.deepEqual(d.nodes.added, []); assert.deepEqual(d.nodes.removed, []);
});

test('internal scope drops externals from the comparison', () => {
  const hand = { nodes: [], edges: [{ from: 'agents', to: 'github' }] };
  const d = drift(hand, code, { internal: new Set(['flows', 'agents', 'kernel']) });
  assert.equal(d.unexplained, 0);
});

test('jaccard basics', () => { assert.equal(jaccard('a b', 'a b'), 1); assert.equal(jaccard('a', 'b'), 0); });
