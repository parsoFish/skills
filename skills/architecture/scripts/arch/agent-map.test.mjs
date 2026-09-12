import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgentMap, agentMapMd } from './agent-map.mjs';

const components = {
  nodes: [{ id: 'flows', files: 4 }, { id: 'agents', files: 6 }, { id: 'kernel', files: 2 }],
  edges: [{ from: 'flows', to: 'agents', count: 8 }, { from: 'agents', to: 'kernel', count: 3 }, { from: 'agents', to: 'flows', count: 2 }],
  cycles: [{ a: 'agents', b: 'flows', ab: 2, ba: 8 }],
};
const drift = { edges: { undeclared: [{ from: 'agents', to: 'kernel', count: 3 }] } };
const fitness = { ok: false, results: [{ id: 'docs.size-cap', ok: true, detail: [] }, { id: 'naming.retired', ok: false, detail: [] }] };

test('buildAgentMap joins components/drift/fitness: imports, importedBy, forbidden (both cycle directions + undeclared), cycles, rules passthrough', () => {
  const map = buildAgentMap({ components, drift, fitness, kinds: { flows: 'service', agents: 'agent', kernel: 'service' } });
  assert.deepEqual(map.components.map(c => c.id), ['agents', 'flows', 'kernel']); // sorted
  const agents = map.components.find(c => c.id === 'agents');
  assert.deepEqual(agents.imports, ['flows', 'kernel']);
  assert.deepEqual(agents.importedBy, ['flows']);
  assert.equal(agents.kind, 'agent');

  assert.deepEqual(map.forbidden.sort((a, b) => a.from.localeCompare(b.from)), [
    { from: 'agents', to: 'flows', reason: 'import cycle (agents<->flows)' },
    { from: 'agents', to: 'kernel', reason: 'undeclared in the hand model' },
    { from: 'flows', to: 'agents', reason: 'import cycle (agents<->flows)' },
  ]);
  assert.deepEqual(map.cycles, components.cycles);
  assert.deepEqual(map.rules, [{ id: 'docs.size-cap', ok: true }, { id: 'naming.retired', ok: false }]);
  assert.equal(map.generatedFrom, null); // no root given
});

test('kind falls back to inferKind (same heuristic model.mjs uses) when not in the kinds override', () => {
  const map = buildAgentMap({ components: { nodes: [{ id: 'cli-tool', files: 1 }], edges: [] } });
  assert.equal(map.components[0].kind, 'cli');
});

test('paths are attributed by re-walking root with the given fold rules, including templated rules', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentmap-'));
  const w = (p, c) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); };
  w('src/core/a.ts', 'export const a = 1;');
  w('src/web/b.ts', "import { a } from '../core/a';\nexport const b = a;");

  const rules = [{ match: '^src/([^/]+)/', component: '$1' }];
  const map = buildAgentMap({ components: { nodes: [{ id: 'core', files: 1 }, { id: 'web', files: 1 }], edges: [{ from: 'web', to: 'core', count: 1 }] }, rules, root });
  const core = map.components.find(c => c.id === 'core');
  const web = map.components.find(c => c.id === 'web');
  assert.deepEqual(core.paths, ['^src/([^/]+)/']); // the rule's original match text, not RegExp#source (which escapes '/')
  assert.deepEqual(web.paths, ['^src/([^/]+)/']);
});

test('paths gracefully stay empty when root or rules are missing', () => {
  const map = buildAgentMap({ components });
  assert.deepEqual(map.components.map(c => c.paths), [[], [], []]);
});

test('seams evidence is matched by seam name (case-insensitive) and folded into provenBy', () => {
  const seams = { tagged: { seams: [{ seam: 'Flows', layers: { unit: 3, contract: 0, journey: 1, ground: 0 } }] } };
  const map = buildAgentMap({ components, seams });
  assert.equal(map.components.find(c => c.id === 'flows').provenBy, 'unit:3 journey:1');
  assert.equal(map.components.find(c => c.id === 'agents').provenBy, null);
});

test('generatedFrom is the real git HEAD sha when root is a git checkout, and null when it is not', () => {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();
  assert.equal(buildAgentMap({ components: { nodes: [] }, root: repoRoot }).generatedFrom, sha);

  const notGit = mkdtempSync(join(tmpdir(), 'nogit-'));
  assert.equal(buildAgentMap({ components: { nodes: [] }, root: notGit }).generatedFrom, null);
});

test('agentMapMd renders the machine table first, then rules that hold, then up to 5 gaps, and stays compact', () => {
  const map = buildAgentMap({ components, drift, fitness, kinds: { agents: 'agent' } });
  const md = agentMapMd(map);
  const lines = md.split('\n');
  assert.ok(lines.length <= 80, `expected <=80 lines, got ${lines.length}`);
  assert.match(md, /^# AGENTS-ARCH\.md/);
  assert.match(md, /\| component \| owns \| may import \| must not import \| proven by \|/);
  // agents may still import kernel (real edge, not forbidden) but must not import flows (cycle) or list kernel as forbidden too (undeclared)
  const agentsRow = lines.find(l => l.startsWith('| agents |'));
  assert.match(agentsRow, /\| flows, kernel \|/); // must-not-import column: cycle partner + undeclared target
  assert.match(md, /## Rules that hold \(1\/2\)/);
  assert.match(md, /- docs\.size-cap/);
  assert.match(md, /## Top gaps/);
  assert.match(md, /import cycle: agents <-> flows/);
  assert.match(md, /rule failing: naming\.retired/);
  assert.match(md, /undeclared: agents -> kernel/);
});

test('agentMapMd caps the component table and the passing-rules list for large maps', () => {
  const manyNodes = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, files: 1 }));
  const manyRules = Array.from({ length: 25 }, (_, i) => ({ id: `rule-${i}`, ok: true }));
  const map = { components: manyNodes.map(n => ({ id: n.id, kind: 'service', files: 1, paths: [], imports: [], importedBy: [], provenBy: null })), forbidden: [], cycles: [], rules: manyRules, generatedFrom: null };
  const md = agentMapMd(map);
  assert.match(md, /… 10 more/); // 60 components - 50 row cap
  assert.match(md, /… 5 more/); // 25 rules - 20 list cap
});
