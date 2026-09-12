#!/usr/bin/env node
// arch — stage-1 kit entry. Deterministic. Read-only on the source tree; writes only under <docsDir>
// (default <root>/docs, or --out <dir>). Subcommands: classify | extract <kind> | drift | check | run
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify } from './classify.mjs';
import { fold, cycles } from './fold.mjs';
import { drift } from './drift.mjs';
import { check } from './check.mjs';
import { extractDeps } from './extract-deps.mjs';
import { extractDelivery } from './extract-delivery.mjs';
import { extractExtPoints } from './extract-ext-points.mjs';
import { extractApi } from './extract-api.mjs';
import { extractTests } from './extract-tests.mjs';
import { extractEnv } from './extract-env.mjs';
import { extractUi } from './extract-ui.mjs';
import { toMarkdown } from './markdown.mjs';
import { specC4, generatedC4, seedHandC4 } from './model.mjs';
import { render } from './render.mjs';
import { evaluate } from './completeness.mjs';
import { buildGaps, interviewMd, kitIssuesMd, projectChangesMd, loadAnswers } from './interview.mjs';
import { checklistMd } from './checklist.mjs';
import { indexMd } from './present.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = name => args.includes(name);
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const cmd = positional[0];
const sub = cmd === 'extract' ? positional[1] : undefined;
const root = resolve(positional[cmd === 'extract' ? 2 : 1] ?? '.');
const docsDir = resolve(flag('--out') ?? join(root, 'docs'));
const P = { ref: join(docsDir, 'reference'), arch: join(docsDir, 'architecture'), run: join(docsDir, 'architecture', '_run'), model: join(docsDir, 'architecture', 'model'), views: join(docsDir, 'reference', 'views') };
const MD_KIND = { 'tests-by-seam': 'tests', 'extension-points': 'ext-points' };
const FILE_NAME = { tests: 'tests-by-seam', 'ext-points': 'extension-points' };

const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s.endsWith('\n') ? s : s + '\n'); };
const emit = (name, json, command) => { write(join(P.ref, `${name}.json`), JSON.stringify(json, null, 1)); write(join(P.ref, `${name}.md`), toMarkdown(MD_KIND[name] ?? name, json, { command })); };

export function loadRules() {
  const p = join(P.arch, 'fold-rules.json');
  return JSON.parse(readFileSync(existsSync(p) ? p : join(here, 'fold-rules.default.json'), 'utf8'));
}

export function extractComponents(rules) {
  const argv = ['--yes', '-p', 'dependency-cruiser@18', 'depcruise', '--no-config', '--output-type', 'json'];
  if (rules.tsConfig) argv.push('--ts-config');
  argv.push('--include-only', rules.include ?? '^(src|apps|packages|lib)', ...(rules.roots ?? ['.']));
  const json = execFileSync('npx', argv, { cwd: root, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const g = fold(JSON.parse(json), rules.rules);
  return { ...g, cycles: cycles(g) };
}

/** Relationships declared in hand.c4: `a -> b 'title'`, `sys.a -[kind]-> sys.b 'title'`. runtime = kind runtime or "(runtime)" in title. */
export function handEdgesFromC4(text, systemId) {
  const edges = [];
  const re = /^\s*([A-Za-z0-9_.]+)\s*-(?:\[([a-z]+)\])?->\s*([A-Za-z0-9_.]+)\s*(?:'([^']*)')?/;
  const strip = id => id.startsWith(systemId + '.') ? id.slice(systemId.length + 1) : id;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re); if (!m) continue;
    edges.push({ from: strip(m[1]), to: strip(m[3]), runtime: m[2] === 'runtime' || /\(runtime\)/.test(m[4] ?? '') });
  }
  return edges;
}

const mdFiles = dir => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).length : 0;

function extractorTable(rules) {
  return { components: () => extractComponents(rules), deps: () => extractDeps(root), delivery: () => extractDelivery(root), 'ext-points': () => extractExtPoints(root, rules.registries), api: () => extractApi(root), tests: () => extractTests(root), env: () => extractEnv(root), ui: () => extractUi(root) };
}

function run() {
  const notes = [];
  const kinds = classify(root); write(join(P.run, 'classify.json'), JSON.stringify(kinds, null, 1));
  const rules = loadRules();
  const sys = rules.system ?? { id: 'system', title: root.split('/').pop() };
  const components = extractComponents(rules); emit('components', components, 'extract components');
  write(join(P.model, 'spec.c4'), specC4());
  write(join(P.model, 'generated.c4'), generatedC4(components, { minorEdgeThreshold: rules.minorEdgeThreshold ?? 5, kinds: rules.kinds ?? {}, titles: rules.titles ?? {}, systemId: sys.id, systemTitle: sys.title }));
  const handPath = join(P.model, 'hand.c4');
  if (!existsSync(handPath)) write(handPath, '// seeded by arch run from the generated graph — annotate freely; arch never overwrites this file\n' + seedHandC4(components, { systemId: sys.id, kind: kinds.kinds[0] ?? 'service' }));
  const hand = { nodes: components.nodes, edges: handEdgesFromC4(readFileSync(handPath, 'utf8'), sys.id) };
  const d = drift(hand, components, { internal: new Set(components.nodes.map(n => n.id)) }); emit('drift', d, 'drift');
  const ex = extractorTable(rules);
  const deps = ex.deps(); emit('deps', deps, 'extract deps');
  const delivery = ex.delivery(); emit('delivery', delivery, 'extract delivery');
  const ext = ex['ext-points'](); emit('extension-points', ext, 'extract ext-points');
  const api = ex.api(); emit('api', api, 'extract api');
  const tests = ex.tests(); emit('tests-by-seam', tests, 'extract tests');
  const env = ex.env(); emit('env', env, 'extract env');
  const ui = ex.ui(); emit('ui', ui, 'extract ui');
  let views = [];
  if (!has('--no-render')) {
    try { const r = render({ modelDir: P.model, outDir: P.views }); views = r.views; notes.push(...r.notes); }
    catch (e) { notes.push(`render failed: ${String(e.message).split('\n')[0]}`); }
  }
  const completeness = evaluate(docsDir, JSON.parse(readFileSync(join(here, '..', '..', 'references', 'completeness.json'), 'utf8')), { retired: rules.retired ?? [] });
  write(join(P.ref, 'completeness.json'), JSON.stringify(completeness, null, 1));
  const present = {
    context: views.includes('index.png') || existsSync(handPath), component: true, deployment: views.includes('deployment.png'),
    scenarios: mdFiles(join(P.arch, 'scenarios')) > 0, catalogue: existsSync(join(P.ref, 'events')), api: api.source === 'openapi' ? true : api.paths?.length ? 'partial' : false,
    'module-graph': existsSync(join(P.ref, 'infra')), adrs: existsSync(join(docsDir, 'decisions')), risks: existsSync(join(P.arch, 'risks.md')),
    'screen-flow': mdFiles(join(P.arch, 'journeys')) > 0, loop: existsSync(join(P.arch, 'loop.md')), 'device-topology': views.includes('deployment.png'),
    'extension-points': (ext.points?.length ?? 0) > 0, signals: existsSync(join(P.arch, 'signals.md')), pipeline: (delivery.workflows?.length ?? 0) > 0,
    credential: existsSync(join(P.arch, 'secrets.md')), deps: true, 'job-dag': existsSync(join(P.ref, 'pipeline.md')), 'data-contracts': existsSync(join(P.ref, 'data')),
    tests: tests.taggingAdopted ? true : tests.total > 0 ? 'partial' : false, stakeholders: existsSync(join(P.arch, 'stakeholders.md')), rules: true,
  };
  write(join(P.arch, 'CHECKLIST.md'), checklistMd(kinds.kinds, present));
  const fitness = check(docsDir, { retired: rules.retired ?? [] }); emit('fitness', fitness, 'check');
  const gaps = buildGaps({ classify: kinds, components, drift: d, deps, delivery, api, tests, env, completeness });
  write(join(P.run, 'gaps.json'), JSON.stringify(gaps, null, 1));
  const answers = loadAnswers(join(P.arch, 'answers.json'));
  write(join(P.run, 'interview.md'), interviewMd(gaps, answers));
  write(join(P.run, 'kit-issues.md'), kitIssuesMd(gaps));
  write(join(P.run, 'project-changes.md'), projectChangesMd(gaps));
  const written = ['overview.md', 'loop.md', 'signals.md', 'secrets.md', 'risks.md', 'stakeholders.md', 'glossary.md', 'CHECKLIST.md'].filter(f => existsSync(join(P.arch, f))).map(f => `../${f}`);
  const generated = readdirSync(P.ref).filter(f => f.endsWith('.md')).sort().map(f => `../../reference/${f}`);
  write(join(P.run, 'index.md'), indexMd({ views: views.map(v => `../../reference/views/${v}`), written, generated, interviewPath: 'interview.md', reviewPath: 'review.md' }));
  const byClass = ['kit', 'project', 'human'].map(c => `${c} ${gaps.filter(g => g.class === c).length}`).join(' · ');
  write(join(P.run, 'run.md'), ['generated by arch run', '', `kinds: ${kinds.kinds.join(' + ')}${kinds.ambiguous ? ' (ambiguous)' : ''}`, `components: ${components.nodes.length} · edges: ${components.edges.length} · cycles: ${components.cycles.length}`, `views rendered: ${views.length}`, `gaps: ${gaps.length} (${byClass})`, '', ...notes.map(n => `- ${n}`)].join('\n'));
  console.log(`kinds ${kinds.kinds.join('+')} · ${components.nodes.length} components · ${components.edges.length} edges · ${components.cycles.length} cycles · ${views.length} views · ${gaps.length} gaps → ${docsDir}`);
}

switch (cmd) {
  case 'classify': console.log(JSON.stringify(classify(root), null, 1)); break;
  case 'extract': {
    const table = extractorTable(loadRules());
    if (!table[sub]) { console.error(`unknown extractor ${sub}; one of ${Object.keys(table).join(', ')}`); process.exitCode = 2; break; }
    const name = FILE_NAME[sub] ?? sub;
    emit(name, table[sub](), `extract ${sub}`); console.log(`wrote reference/${name}.{json,md}`); break;
  }
  case 'drift': {
    const code = JSON.parse(readFileSync(join(P.ref, 'components.json'), 'utf8'));
    const sys = loadRules().system ?? { id: 'system' };
    const hp = join(P.model, 'hand.c4');
    const hand = { nodes: code.nodes, edges: existsSync(hp) ? handEdgesFromC4(readFileSync(hp, 'utf8'), sys.id) : [] };
    const d = drift(hand, code, { internal: new Set(code.nodes.map(n => n.id)) }); emit('drift', d, 'drift');
    console.log(`unexplained: ${d.unexplained}; in code not hand: ${d.edges.inCodeNotHand.length}`); break;
  }
  case 'check': {
    const r = check(docsDir, { retired: loadRules().retired ?? [] }); emit('fitness', r, 'check');
    for (const x of r.results) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.id}${x.detail.length ? ' — ' + x.detail.slice(0, 5).join(', ') : ''}`);
    process.exitCode = r.ok ? 0 : 1; break;
  }
  case 'run': run(); break;
  default: console.log('usage: arch <classify|extract <kind>|drift|check|run> [root] [--out <docsDir>] [--no-render]'); process.exitCode = 2;
}
