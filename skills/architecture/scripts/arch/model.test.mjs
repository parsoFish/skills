import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specC4, generatedC4, seedHandC4, sanitizeId } from './model.mjs';

const components = {
  nodes: [
    { id: 'payments', files: 12 },
    { id: 'webui', files: 30 },
    { id: 'kernel', files: 3 },
  ],
  edges: [
    { from: 'webui', to: 'payments', count: 19 },
    { from: 'payments', to: 'kernel', count: 2 },
  ],
};

test('specC4 reads the legend file verbatim', () => {
  const text = specC4();
  assert.match(text, /specification \{/);
  assert.match(text, /element service/);
});

test('sanitizeId lowercases, strips disallowed chars, guards leading digits', () => {
  assert.equal(sanitizeId('My-Comp.1'), 'my_comp_1');
  assert.equal(sanitizeId('2fast'), 'c_2fast');
  assert.equal(sanitizeId('___'), 'x');
});

test('generatedC4 emits system, components with technology, and imports/minor edges', () => {
  const c4 = generatedC4(components, { minorEdgeThreshold: 5, systemTitle: 'Acme' });
  assert.match(c4, /model \{/);
  assert.match(c4, /system system 'Acme' \{/);
  assert.match(c4, /service payments 'payments' \{\n\s+technology '12 files'/);
  assert.match(c4, /system\.webui -\[imports\]-> system\.payments '19'/);
  assert.match(c4, /system\.payments -\[minor\]-> system\.kernel/);
  assert.ok(!c4.includes("payments -[minor]-> system.kernel '2'"));
});

test('generatedC4 respects kind and title overrides and sanitises ids', () => {
  const c4 = generatedC4(
    { nodes: [{ id: 'My Comp', files: 1 }], edges: [] },
    { kinds: { 'My Comp': 'cli' }, titles: { 'My Comp': 'My Comp' } },
  );
  assert.match(c4, /cli my_comp 'My Comp'/);
});

test('generatedC4 handles empty graphs', () => {
  const c4 = generatedC4({ nodes: [], edges: [] });
  assert.match(c4, /system system 'system' \{\n\s*\}/);
});

test('seedHandC4 default kind gets base externals only, no modelapi', () => {
  const c4 = seedHandC4(components, { systemId: 'acme' });
  assert.match(c4, /human operator 'Human operator'/);
  assert.match(c4, /external github 'GitHub'/);
  assert.match(c4, /workspace workspace 'Workspace'/);
  assert.match(c4, /log log 'Log'/);
  assert.ok(!c4.includes('modelapi'));
});

test('seedHandC4 agent kind adds modelapi external', () => {
  const c4 = seedHandC4(components, { systemId: 'acme', kind: 'agent' });
  assert.match(c4, /modelapi modelapi 'Model API'/);
});

test('seedHandC4 relates operator to the first webui/cli-like component', () => {
  const c4 = seedHandC4(components, { systemId: 'acme' });
  assert.match(c4, /operator -> acme\.webui 'uses'/);
});

test('seedHandC4 emits the four required views with excludes and a dynamic mainPath from the two heaviest edges', () => {
  const c4 = seedHandC4(components, { systemId: 'acme' });
  assert.match(c4, /view index \{[\s\S]*exclude acme\.\*/);
  assert.match(c4, /view containers of acme \{[\s\S]*include acme\.webui, acme\.payments, acme\.kernel/);
  assert.match(c4, /view components of acme \{[\s\S]*exclude \* -> \* where kind is minor[\s\S]*exclude operator, github, workspace, log/);
  assert.match(c4, /dynamic view mainPath \{[\s\S]*acme\.webui -> acme\.payments 'imports'[\s\S]*acme\.payments -> acme\.kernel 'imports'/);
});

test('seedHandC4 caps containers view at 12 top components by files', () => {
  const many = { nodes: Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, files: 15 - i })), edges: [] };
  const c4 = seedHandC4(many, { systemId: 'sys' });
  const line = c4.match(/include ((?:sys\.c\d+(?:, )?)+)/)[1];
  assert.equal(line.split(', ').length, 12);
  assert.ok(line.startsWith('sys.c0'));
});

test('seedHandC4 is pure: does not touch the filesystem and returns fresh text each call', () => {
  const a = seedHandC4(components, { systemId: 'acme' });
  const b = seedHandC4(components, { systemId: 'acme' });
  assert.equal(a, b);
});
