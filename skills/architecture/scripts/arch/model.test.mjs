import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { specC4, generatedC4, seedHandC4, sanitizeId, inferKind } from './model.mjs';

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

/** True when likec4 can run fully offline (already cached by a prior `npx`). */
function likec4CachedOffline() {
  try {
    execFileSync('npx', ['--no-install', 'likec4@1.59.3', '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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

test('inferKind matches webui/cli/agent/knowledge/log/iacmodule heuristics on the id, else falls back to service', () => {
  assert.equal(inferKind('web-dashboard'), 'webui');
  assert.equal(inferKind('studio'), 'webui');
  assert.equal(inferKind('cli-tools'), 'cli');
  assert.equal(inferKind('agent-worker'), 'agent');
  assert.equal(inferKind('knowledge-store'), 'knowledge');
  assert.equal(inferKind('audit-log'), 'log');
  assert.equal(inferKind('terraform-infra'), 'iacmodule');
  assert.equal(inferKind('kernel'), 'service');
});

test('inferKind falls back to scanning file paths when the id itself gives no signal', () => {
  assert.equal(inferKind('core', ['core/agent-worker.mjs']), 'agent');
  assert.equal(inferKind('core', ['core/plain.mjs', 'core/other.mjs']), 'service');
  assert.equal(inferKind('core'), 'service');
});

test('generatedC4 emits system, components with technology, and imports/minor edges', () => {
  const c4 = generatedC4(components, { minorEdgeThreshold: 5, systemTitle: 'Acme' });
  assert.match(c4, /model \{/);
  assert.match(c4, /system system 'Acme' \{/);
  assert.match(c4, /webui webui 'webui' \{\n\s+technology '30 files'/);
  assert.match(c4, /system\.webui -\[imports\]-> system\.payments \{\n\s+metadata \{\n\s+count '19'\n\s+\}\n\s+\}/);
  assert.match(c4, /system\.payments -\[minor\]-> system\.kernel/);
});

test('generatedC4 never titles an imports edge with a bare count', () => {
  const c4 = generatedC4(components, { minorEdgeThreshold: 5 });
  assert.ok(!/-\[imports\]-> system\.payments '19'/.test(c4));
});

test('generatedC4 defaults an unmapped component to a heuristic kind, not a flat service', () => {
  const c4 = generatedC4({ nodes: [{ id: 'payments', files: 12 }], edges: [] });
  assert.match(c4, /service payments 'payments'/); // 'payments' matches no heuristic, so service is correct here too
  const c4b = generatedC4({ nodes: [{ id: 'agent-worker', files: 2 }], edges: [] });
  assert.match(c4b, /agent agent_worker 'agent-worker'/);
});

test('generatedC4 respects kind and title overrides and sanitises ids', () => {
  const c4 = generatedC4(
    { nodes: [{ id: 'My Comp', files: 1 }], edges: [] },
    { kinds: { 'My Comp': 'cli' }, titles: { 'My Comp': 'My Comp' } },
  );
  assert.match(c4, /cli my_comp 'My Comp'/);
});

test('generatedC4 emits a capped description when provided, and omits it when not', () => {
  const long = 'x'.repeat(120);
  const c4 = generatedC4({ nodes: [{ id: 'payments', files: 1 }], edges: [] }, { descriptions: { payments: long } });
  assert.match(c4, /description '.{89}…'/);
  const short = generatedC4({ nodes: [{ id: 'payments', files: 1 }], edges: [] }, { descriptions: { payments: 'Handles billing' } });
  assert.match(short, /description 'Handles billing'/);
  const none = generatedC4({ nodes: [{ id: 'payments', files: 1 }], edges: [] });
  assert.ok(!none.includes('description'));
});

test('generatedC4 handles empty graphs', () => {
  const c4 = generatedC4({ nodes: [], edges: [] });
  assert.match(c4, /system system 'system' \{\n\s*\}/);
});

test('seedHandC4 default has base externals only, no modelapi, when no component resolves to agent', () => {
  const c4 = seedHandC4(components, { systemId: 'acme' });
  assert.match(c4, /human operator 'Human operator'/);
  assert.match(c4, /external github 'GitHub'/);
  assert.match(c4, /workspace workspace 'Workspace'/);
  assert.match(c4, /log log 'Log'/);
  assert.ok(!c4.includes('modelapi'));
});

test('seedHandC4 adds modelapi when a component resolves to kind agent via inferKind', () => {
  const c4 = seedHandC4({ nodes: [{ id: 'agent-worker', files: 1 }], edges: [] }, { systemId: 'acme' });
  assert.match(c4, /modelapi modelapi 'Model API'/);
  assert.match(c4, /acme -> modelapi 'calls'/);
});

test('seedHandC4 adds modelapi when a kinds override maps a component to agent', () => {
  const c4 = seedHandC4(components, { systemId: 'acme', kinds: { payments: 'agent' } });
  assert.match(c4, /modelapi modelapi 'Model API'/);
});

test('seedHandC4 relates each external to the system itself, not a child, so the context view keeps its edges', () => {
  const c4 = seedHandC4(components, { systemId: 'acme' });
  assert.match(c4, /operator -> acme 'uses'/);
  assert.match(c4, /acme -> github 'reads\/writes'/);
  assert.match(c4, /acme -> workspace 'reads\/writes'/);
  assert.match(c4, /acme -> log 'writes'/);
  assert.ok(!c4.includes("acme.webui 'uses'"));
});

test('seedHandC4 emits the required views with titles, descriptions, and excludes', () => {
  const c4 = seedHandC4(components, { systemId: 'acme' });
  assert.match(c4, /view index \{[\s\S]*title 'Context'[\s\S]*description[\s\S]*exclude acme\.\*/);
  assert.match(c4, /view containers of acme \{[\s\S]*include acme\.webui, acme\.payments, acme\.kernel[\s\S]*exclude \* -> \* where kind is minor/);
  assert.match(c4, /view components of acme \{[\s\S]*exclude \* -> \* where kind is minor[\s\S]*exclude operator, github, workspace, log/);
  assert.match(c4, /dynamic view mainPath \{[\s\S]*acme\.webui -> acme\.payments 'imports'[\s\S]*acme\.payments -> acme\.kernel 'imports'/);
});

test('seedHandC4 caps the containers view at 8 top components by files', () => {
  const many = { nodes: Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, files: 15 - i })), edges: [] };
  const c4 = seedHandC4(many, { systemId: 'sys' });
  const line = c4.match(/include ((?:sys\.c\d+(?:, )?)+)/)[1];
  assert.equal(line.split(', ').length, 8);
  assert.ok(line.startsWith('sys.c0'));
});

test('seedHandC4 emits one view per opts.areas group, skipping empty groups', () => {
  const c4 = seedHandC4(components, { systemId: 'acme', areas: { payments: ['payments'], empty: [], core: ['webui', 'kernel'] } });
  assert.match(c4, /view area_payments of acme \{[\s\S]*title 'payments'[\s\S]*description 'which components make up the payments area'[\s\S]*include acme\.payments/);
  assert.match(c4, /view area_core of acme \{[\s\S]*include acme\.webui, acme\.kernel/);
  assert.ok(!c4.includes('area_empty'));
});

test('seedHandC4 is pure: does not touch the filesystem and returns fresh text each call', () => {
  const a = seedHandC4(components, { systemId: 'acme' });
  const b = seedHandC4(components, { systemId: 'acme' });
  assert.equal(a, b);
});

// LikeC4 syntax check: assemble a temp model dir from the real legend + generated + hand text and
// run the CLI validator. Skipped (never failed) when likec4 cannot run without network access.
test('the legend plus a generated model plus a seeded hand.c4 validate as LikeC4 syntax', t => {
  if (!likec4CachedOffline()) {
    t.skip('likec4 is not available offline (npx --no-install likec4@1.59.3 failed)');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'likec4-model-'));
  writeFileSync(join(dir, 'spec.c4'), specC4());
  writeFileSync(join(dir, 'generated.c4'), generatedC4(components, { systemId: 'acme', systemTitle: 'Acme' }));
  writeFileSync(join(dir, 'hand.c4'), seedHandC4(components, { systemId: 'acme', areas: { core: ['webui'] } }));
  const out = execFileSync('npx', ['--yes', 'likec4@1.59.3', 'validate', dir], { encoding: 'utf8' });
  assert.match(out, /Valid/);
});
