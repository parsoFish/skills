import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, cycles, componentOf, compile } from './fold.mjs';

const rules = [
  { match: '^apps/forge/', component: 'forge_cli' },
  { match: '^apps/([^/]+)/', component: '$1' },
  { match: '^packages/([^/]+)/', component: '$1' },
];
const dc = { modules: [
  { source: 'packages/flows/a.ts', dependencies: [{ resolved: 'packages/kernel/x.ts' }, { resolved: 'packages/agents/y.ts' }, { resolved: 'packages/flows/b.ts' }] },
  { source: 'packages/agents/y.ts', dependencies: [{ resolved: 'packages/flows/a.ts' }] },
  { source: 'packages/kernel/x.ts', dependencies: [] },
  { source: 'packages/flows/tests/a.test.ts', dependencies: [{ resolved: 'apps/forge/cli.ts' }] },
  { source: 'apps/studio/app/page.tsx', dependencies: [{ resolved: 'packages/contracts/i.ts' }] },
  { source: 'node_modules/zod/index.js', dependencies: [] },
] };

test('componentOf applies first matching rule with captures', () => {
  const c = compile(rules);
  assert.equal(componentOf('apps/forge/cli.ts', c), 'forge_cli');
  assert.equal(componentOf('apps/studio/x.tsx', c), 'studio');
  assert.equal(componentOf('node_modules/x', c), null);
});

test('fold counts production files and edges, excludes tests and self edges', () => {
  const g = fold(dc, rules);
  assert.deepEqual(g.nodes.map(n => n.id), ['agents', 'flows', 'kernel', 'studio']);
  assert.equal(g.nodes.find(n => n.id === 'flows').tests, 1);
  assert.ok(!g.edges.some(e => e.from === 'flows' && e.to === 'forge_cli'), 'test-only edge excluded');
  assert.ok(!g.edges.some(e => e.from === e.to));
  assert.deepEqual(g.edges[0], { from: 'agents', to: 'flows', count: 1 });
});

test('fold is deterministic: same input twice gives identical JSON', () => {
  assert.equal(JSON.stringify(fold(dc, rules)), JSON.stringify(fold(dc, rules)));
});

test('cycles finds two-way edges once', () => {
  const c = cycles(fold(dc, rules));
  assert.deepEqual(c, [{ a: 'agents', b: 'flows', ab: 1, ba: 1 }]);
});

test('excludeTests=false keeps test edges', () => {
  const g = fold(dc, rules, { excludeTests: false });
  assert.ok(g.edges.some(e => e.from === 'flows' && e.to === 'forge_cli'));
});
