#!/usr/bin/env node
// arch — stage-1 kit entry. Deterministic. Read-only on the source tree; writes only under <docsDir>
// (default <root>/docs, or --out <dir>). Subcommands: classify | extract <kind> | drift | check | run | guard <snapshot|verify|close>
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify, foldRulesCheatSheet } from './classify.mjs';
import { fold, cycles } from './fold.mjs';
import { drift, writeBaselineProposal, shrinkBaseline } from './drift.mjs';
import { check } from './check.mjs';
import { extractDeps } from './extract-deps.mjs';
import { extractDelivery } from './extract-delivery.mjs';
import { extractExtPoints } from './extract-ext-points.mjs';
import { extractApi } from './extract-api.mjs';
import { extractTests } from './extract-tests.mjs';
import { extractEnv } from './extract-env.mjs';
import { extractUi } from './extract-ui.mjs';
import { extractImports } from './extract-imports.mjs';
import { extractGo } from './extract-go.mjs';
import * as tf from './extract-terraform.mjs';
import * as adrs from './extract-adrs.mjs';
import { toMarkdown } from './markdown.mjs';
import { specC4, generatedC4, seedHandC4 } from './model.mjs';
import { render } from './render.mjs';
import { evaluate } from './completeness.mjs';
import { buildGaps, interviewMd, kitIssuesMd, projectChangesMd, loadAnswers, reconcileProjectChanges } from './interview.mjs';
import { briefMd } from './brief.mjs';
import { checklistMd, viewShape, requiredViews } from './checklist.mjs';
import { indexMd } from './present.mjs';
import { bundleHtml } from './present-html.mjs';
import { buildAgentMap, agentMapMd } from './agent-map.mjs';
import { writeSnapshot, readSnapshot, guardReport, isOpen, close as closeGuard } from './guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// Pinned tool versions live in one place, tools.json at the repo/plugin root (four levels up from
// this skill-script directory), so a byte-identical rerun never depends on "whatever npx resolved
// today" and there is exactly one place to bump a version.
const TOOLS = JSON.parse(readFileSync(join(here, '..', '..', '..', '..', 'tools.json'), 'utf8'));
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = name => args.includes(name);
const VALUE_FLAGS = new Set(['--out', '--now']);
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
const cmd = positional[0];
const sub = cmd === 'extract' || cmd === 'guard' ? positional[1] : undefined;
const root = resolve(positional[cmd === 'extract' || cmd === 'guard' ? 2 : 1] ?? '.');
const docsDir = resolve(flag('--out') ?? join(root, 'docs'));
const isEntry = import.meta.url === `file://${process.argv[1]}`;
// Safety: without --out, arch only writes into a docs tree it manages (marker docs/reference/.arch-managed) or a docs tree that does not exist yet.
if (isEntry && !flag('--out') && existsSync(docsDir) && !existsSync(join(docsDir, 'reference', '.arch-managed')) && !['classify', undefined].includes(cmd)) {
  console.error(`refusing to write into ${docsDir}: it exists but is not managed by arch. Pass --out <dir>, or create ${join(docsDir, 'reference', '.arch-managed')} to adopt it.`);
  process.exit(3);
}
const P = { ref: join(docsDir, 'reference'), arch: join(docsDir, 'architecture'), run: join(docsDir, 'architecture', '_run'), model: join(docsDir, 'architecture', 'model'), views: join(docsDir, 'reference', 'views'), decisions: join(docsDir, 'decisions') };
const MD_KIND = { 'tests-by-seam': 'tests', 'extension-points': 'ext-points' };
const FILE_NAME = { tests: 'tests-by-seam', 'ext-points': 'extension-points' };

const sha = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } })();
const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s.endsWith('\n') ? s : s + '\n'); };
const stamp = md => { const [first, ...rest] = md.split('\n'); return [first, `source: ${sha ?? 'unknown'}`, ...rest].join('\n'); };
const emit = (name, json, command) => { write(join(P.ref, `${name}.json`), JSON.stringify(json, null, 1)); write(join(P.ref, `${name}.md`), stamp(toMarkdown(MD_KIND[name] ?? name, json, { command }))); };
const markManaged = () => { const m = join(P.ref, '.arch-managed'); if (!existsSync(m)) write(m, 'managed by arch — generated files live here'); };
const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };

export function loadRules() {
  const p = join(P.arch, 'fold-rules.json');
  return JSON.parse(readFileSync(existsSync(p) ? p : join(here, 'fold-rules.default.json'), 'utf8'));
}

/** engine: 'builtin' (default — offline relative-import scanner for JS/TS), 'go' (offline Go package scanner), or 'dependency-cruiser' (opt-in; resolves tsconfig paths via npx). */
export function extractComponents(rules) {
  let dc;
  const engine = rules.engine ?? 'builtin';
  if (engine === 'dependency-cruiser') {
    const argv = ['--yes', '-p', `dependency-cruiser@${TOOLS['dependency-cruiser']}`, 'depcruise', '--no-config', '--output-type', 'json'];
    if (rules.tsConfig) argv.push('--ts-config');
    argv.push('--include-only', rules.include ?? '^(src|apps|packages|lib)', ...(rules.roots ?? ['.']));
    dc = JSON.parse(execFileSync('npx', argv, { cwd: root, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString());
  } else if (engine === 'go') {
    dc = extractGo(root, { ignore: rules.scanIgnore ?? [] });
  } else {
    dc = extractImports(root, { ignore: rules.scanIgnore ?? [], include: rules.include ?? '^(src|apps|packages|lib)' });
  }
  const g = fold(dc, rules.rules);
  return { ...g, cycles: cycles(g), engine };
}

/** Relationships declared in hand.c4: `a -> b 'title'`, `a -[kind]-> b 'title'`. runtime = kind runtime or "(runtime)" in title. */
export function handEdgesFromC4(text, systemId) {
  const edges = [];
  const re = /^\s*([A-Za-z0-9_.]+)\s*-(?:\[([a-z]+)\]-)?>\s*([A-Za-z0-9_.]+)\s*(?:'([^']*)')?/;
  const strip = id => id.startsWith(systemId + '.') ? id.slice(systemId.length + 1) : id;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re); if (!m) continue;
    edges.push({ from: strip(m[1]), to: strip(m[3]), runtime: m[2] === 'runtime' || /\(runtime\)/.test(m[4] ?? '') });
  }
  return edges;
}

/** View titles/descriptions declared in hand.c4: `view id … { title '…' description '…' }`. */
export function viewMetaFromC4(text) {
  const out = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const v = line.match(/^\s*(?:dynamic\s+)?view\s+([A-Za-z0-9_]+)/); if (v) { current = v[1]; out[current] = out[current] ?? {}; continue; }
    const t = line.match(/^\s*title\s+'([^']*)'/); if (t && current) out[current].title = t[1];
    const d = line.match(/^\s*description\s+'([^']*)'/); if (d && current) out[current].description = d[1];
  }
  return out;
}

/** Presence by shape (a diagram fence, the right table columns), never by inode alone. */
export function presentByShape(view) {
  const s = viewShape(view);
  if (!s.file) return false;
  const p = join(docsDir, s.file);
  if (!existsSync(p)) return false;
  if (s.file.endsWith('.png')) return s.file;
  let text = '';
  if (s.file.endsWith('/')) { const files = readdirSync(p).filter(f => f.endsWith('.md')); if (!files.length) return false; text = files.map(f => readFileSync(join(p, f), 'utf8')).join('\n'); }
  else text = readFileSync(p, 'utf8');
  if (s.needsFence && !/```mermaid|<svg/i.test(text)) return 'partial';
  if (s.needsTableColumns.length) { const header = (text.match(/^\|.*\|$/m) ?? [''])[0].toLowerCase(); if (!s.needsTableColumns.every(c => header.includes(c.toLowerCase()))) return 'partial'; }
  return s.file;
}

function legendFromSpec() {
  const spec = specC4();
  return [...spec.matchAll(/element\s+(\w+)\s*\{\s*notation\s+'([^']*)'\s*style\s*\{[^}]*color\s+(\w+)/g)]
    .map(m => ({ kind: m[1], notation: m[2], colour: (spec.match(new RegExp(`color\\s+${m[3]}\\s+(#[0-9A-Fa-f]{6})`)) ?? [, '#7C869A'])[1] }));
}

function extractorTable(rules) {
  const o = { ignore: rules.scanIgnore ?? [] };
  return { components: () => extractComponents(rules), deps: () => extractDeps(root, o), delivery: () => extractDelivery(root, o), 'ext-points': () => extractExtPoints(root, rules.registries, o), api: () => extractApi(root, o), tests: () => extractTests(root, o), env: () => extractEnv(root, o), ui: () => extractUi(root, o) };
}

function run() {
  if (isOpen(docsDir) && !has('--force')) { console.error('a stage-2 review is open on this docs dir (architecture/_run/.stage2-guard.json without .stage2-done); finish it with `arch guard close`, or pass --force'); process.exitCode = 4; return; }
  const notes = [];
  markManaged();
  const kinds = classify(root); write(join(P.run, 'classify.json'), JSON.stringify(kinds, null, 1));
  const rules = loadRules();
  const sys = rules.system ?? { id: 'system', title: basename(root) };
  const components = extractComponents(rules); emit('components', components, 'extract components');
  write(join(P.model, 'spec.c4'), specC4());
  write(join(P.model, 'generated.c4'), generatedC4(components, { minorEdgeThreshold: rules.minorEdgeThreshold ?? 5, kinds: rules.kinds ?? {}, titles: rules.titles ?? {}, descriptions: rules.descriptions ?? {}, systemId: sys.id, systemTitle: sys.title }));
  const handPath = join(P.model, 'hand.c4');
  if (!existsSync(handPath)) write(handPath, '// seeded by arch run from the generated graph — annotate freely; arch never overwrites this file\n' + seedHandC4(components, { systemId: sys.id, kinds: rules.kinds ?? {}, areas: rules.areas ?? {} }));
  const handText = readFileSync(handPath, 'utf8');
  const hand = { nodes: components.nodes, edges: handEdgesFromC4(handText, sys.id) };
  // drift with a shrink-only baseline; a first run proposes one
  const internal = new Set(components.nodes.map(n => n.id));
  const baselinePath = join(P.arch, 'drift-baseline.json');
  let baseline = readJson(baselinePath, null);
  if (!baseline) { baseline = writeBaselineProposal(drift(hand, components, { internal, baseline: { edges: [] } })); write(baselinePath, JSON.stringify({ ...baseline, note: 'seeded by the first arch run with every then-undeclared edge; shrink it as edges are declared in hand.c4 — arch never grows it' }, null, 1)); }
  const d = drift(hand, components, { internal, baseline }); emit('drift', d, 'drift');
  if (d.edges.baselineStale.length) { write(baselinePath, JSON.stringify(shrinkBaseline(baseline, d), null, 1)); notes.push(`drift-baseline.json shrunk: ${d.edges.baselineStale.length} stale entries removed`); }
  const ex = extractorTable(rules);
  const deps = ex.deps(); emit('deps', deps, 'extract deps');
  const delivery = ex.delivery(); emit('delivery', delivery, 'extract delivery');
  const ext = ex['ext-points'](); emit('extension-points', ext, 'extract ext-points');
  const api = ex.api(); emit('api', api, 'extract api');
  const tests = ex.tests(); emit('tests-by-seam', tests, 'extract tests');
  const env = ex.env(); emit('env', env, 'extract env');
  const ui = ex.ui(); emit('ui', ui, 'extract ui');
  // ADRs live in the SOURCE root, never in --out
  const adrJson = adrs.extractAdrs(root);
  if ((adrJson.adrs ?? []).length) { write(join(P.decisions, 'README.md'), stamp(adrs.adrIndexMd(adrJson))); write(join(P.ref, 'adrs.json'), JSON.stringify(adrJson, null, 1)); }
  // Terraform module graph when the repo is IaC
  let infra = null;
  if (typeof tf.extractTerraform === 'function' && (kinds.kinds.includes('iac') || rules.engine === 'terraform')) {
    infra = tf.extractTerraform(root, { ignore: rules.scanIgnore ?? [] });
    write(join(P.ref, 'infra.json'), JSON.stringify(infra, null, 1)); write(join(P.ref, 'infra.md'), stamp(tf.terraformMarkdown(infra)));
  }
  let views = [];
  if (!has('--no-render')) {
    try { const r = render({ modelDir: P.model, outDir: P.views }); views = r.views; notes.push(...r.notes); }
    catch (e) { notes.push(`render failed: ${String(e.message).split('\n')[0]}`); }
  }
  const scenariosRequired = requiredViews(kinds.kinds).find(v => v.view === 'scenarios')?.required === '✓';
  const completeness = evaluate(docsDir, JSON.parse(readFileSync(join(here, '..', '..', 'references', 'completeness.json'), 'utf8')), { retired: rules.retired ?? [], now: flag('--now'), minScenarios: scenariosRequired ? (kinds.kinds.includes('service') ? 2 : 1) : 0 });
  write(join(P.ref, 'completeness.json'), JSON.stringify(completeness, null, 1));
  const present = Object.fromEntries(['context', 'component', 'deployment', 'scenarios', 'catalogue', 'api', 'module-graph', 'adrs', 'risks', 'screen-flow', 'loop', 'device-topology', 'extension-points', 'signals', 'pipeline', 'credential', 'deps', 'job-dag', 'data-contracts', 'tests', 'stakeholders', 'rules', 'quality'].map(v => [v, presentByShape(v)]));
  if (views.includes('index.png')) present.context = 'reference/views/index.png';
  present.component = 'reference/components.md'; present.deps = 'reference/deps.md'; present.rules = 'reference/fitness.md';
  present.tests = tests.taggingAdopted ? 'reference/tests-by-seam.md' : tests.total > 0 ? 'partial' : false;
  present['extension-points'] = (ext.points ?? []).some(x => x.count > 0) ? 'reference/extension-points.md' : false;
  present.pipeline = (delivery.workflows?.length ?? 0) > 0 ? 'reference/delivery.md' : false;
  present.api = api.source === 'openapi' ? 'reference/api.md' : api.paths?.length ? 'partial' : false;
  if (infra && (infra.modules?.length ?? 0) > 0) present['module-graph'] = 'reference/infra.md';
  write(join(P.arch, 'CHECKLIST.md'), checklistMd(kinds.kinds, present));
  const fitness = check(docsDir, { retired: rules.retired ?? [], root, sha }); emit('fitness', fitness, 'check');
  // agent map: the coding agent's first read
  const map = buildAgentMap({ components, drift: d, fitness, rules: rules.rules, kinds: rules.kinds ?? {}, root, ignore: rules.scanIgnore ?? [], include: rules.include });
  write(join(P.ref, 'agent-map.json'), JSON.stringify(map, null, 1)); write(join(P.arch, 'AGENTS-ARCH.md'), stamp(agentMapMd(map)));
  const gaps = buildGaps({ classify: kinds, components, drift: d, deps, delivery, api, tests, env, completeness });
  write(join(P.run, 'gaps.json'), JSON.stringify(gaps, null, 1));
  const answers = loadAnswers(join(P.arch, 'answers.json'));
  write(join(P.run, 'questions.md'), interviewMd(gaps, answers)); // kit questions; stage 2 curates them into interview.md
  write(join(P.run, 'kit-issues.md'), kitIssuesMd(gaps));
  // the one file stage 2 has to read before writing anything
  write(join(P.run, 'brief.md'), briefMd({ sys, kinds, components, rules, drift: d, baseline, fitness, completeness, handEdges: hand.edges, gaps, sha }));
  const prevChanges = readJson(join(P.run, 'project-changes.json'), null);
  const iso = x => (x ? new Date(x).toISOString() : x);
  const changes = reconcileProjectChanges(prevChanges ?? [], gaps, flag('--now') ? new Date(flag('--now')) : new Date(0))
    .map(c => ({ ...c, firstSeen: iso(c.firstSeen), lastSeen: iso(c.lastSeen), status: prevChanges === null && c.status === 'new' ? 'open' : c.status })); // a first run has nothing to be new against; dates always ISO
  write(join(P.run, 'project-changes.json'), JSON.stringify(changes, null, 1));
  write(join(P.run, 'project-changes.md'), projectChangesMd(gaps, changes));
  // human bundle: index.md + one self-contained page
  const meta = viewMetaFromC4(handText);
  const titles = Object.fromEntries(Object.entries(meta).filter(([, v]) => v.title).map(([k, v]) => [k, v.title]));
  const writtenList = ['overview.md', 'quality.md', 'AGENTS-ARCH.md', 'loop.md', 'signals.md', 'secrets.md', 'risks.md', 'stakeholders.md', 'glossary.md', 'deps.md', 'CHECKLIST.md'].filter(f => existsSync(join(P.arch, f))).map(f => `../${f}`)
    .concat(['scenarios', 'journeys'].flatMap(dn => existsSync(join(P.arch, dn)) ? readdirSync(join(P.arch, dn)).filter(f => f.endsWith('.md')).sort().map(f => `../${dn}/${f}`) : []));
  const generatedList = readdirSync(P.ref).filter(f => f.endsWith('.md')).sort().map(f => `../../reference/${f}`).concat(existsSync(join(P.decisions, 'README.md')) ? ['../../decisions/README.md'] : []);
  const interviewPath = existsSync(join(P.run, 'interview.md')) ? 'interview.md' : 'questions.md';
  write(join(P.run, 'index.md'), indexMd({ views, written: writtenList, generated: generatedList, interviewPath, reviewPath: existsSync(join(P.run, 'review.md')) ? 'review.md' : undefined, titles }));
  const md = rel => ({ path: rel, markdown: readFileSync(join(P.run, rel), 'utf8') });
  const byClass = ['kit', 'project', 'human'].map(c => `${c} ${gaps.filter(g => g.class === c).length}`).join(' · ');
  write(join(P.run, 'run.md'), ['generated by arch run', `source: ${sha ?? 'unknown'}`, '', `kinds: ${kinds.kinds.join(' + ')}${kinds.ambiguous ? ' (ambiguous)' : ''}`, `components: ${components.nodes.length} · edges: ${components.edges.length} · cycles: ${components.cycles.length} · engine: ${components.engine}`, `drift: ${d.unexplained} unexplained (${d.edges.undeclared.length} undeclared, ${d.edges.inHandNotCode.length} claimed-but-absent) · baseline ${baseline.edges.length}`, `views rendered: ${views.length}`, `fitness: ${fitness.ok ? 'all rules pass' : fitness.results.filter(r => !r.ok).length + ' rule(s) failing'} · completeness: ${completeness.verdict}`, `gaps: ${gaps.length} (${byClass})`, '', ...notes.map(n => `- ${n}`)].join('\n'));
  write(join(P.run, 'index.html'), bundleHtml({
    views: views.map(v => { const id = v.replace(/\.png$/, ''); return { id, title: meta[id]?.title ?? id, description: meta[id]?.description ?? '', pngPath: join(P.views, v) }; }),
    written: writtenList.map(md), generated: generatedList.map(md),
    run: ['interview.md', 'questions.md', 'review.md', 'project-changes.md', 'kit-issues.md', 'brief.md', 'run.md'].filter(f => existsSync(join(P.run, f))).map(f => ({ path: f, markdown: readFileSync(join(P.run, f), 'utf8') })),
    legend: legendFromSpec(), meta: { project: sys.title, sha: sha ?? 'unknown', generatedBy: 'arch run' },
  }));
  console.log(`kinds ${kinds.kinds.join('+')} · ${components.nodes.length} components · ${components.edges.length} edges · ${components.cycles.length} cycles · drift ${d.unexplained} · ${views.length} views · ${gaps.length} gaps → ${docsDir}`);
}

if (isEntry) switch (cmd) {
  case 'classify':
    if (has('--help-fold-rules')) { console.log(foldRulesCheatSheet()); break; }
    console.log(JSON.stringify(classify(root), null, 1)); break;
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
    const d = drift(hand, code, { internal: new Set(code.nodes.map(n => n.id)), baseline: readJson(join(P.arch, 'drift-baseline.json'), { edges: [] }) }); emit('drift', d, 'drift');
    console.log(`unexplained: ${d.unexplained} (${d.edges.undeclared.length} undeclared, ${d.edges.inHandNotCode.length} claimed-but-absent); baselined: ${d.edges.inCodeNotHand.length - d.edges.undeclared.length}`);
    process.exitCode = d.unexplained ? 1 : 0; break;
  }
  case 'check': {
    const r = check(docsDir, { retired: loadRules().retired ?? [], root, sha }); emit('fitness', r, 'check');
    for (const x of r.results) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.id}${x.detail.length ? ' — ' + x.detail.slice(0, 5).join(', ') : ''}`);
    process.exitCode = r.ok ? 0 : 1; break;
  }
  case 'run': run(); break;
  case 'guard': {
    if (sub === 'snapshot') { const p = writeSnapshot(docsDir); console.log(`stage-2 snapshot written: ${p}`); break; }
    if (sub === 'verify') { const g = guardReport(docsDir, readSnapshot(docsDir), { fitness: readJson(join(P.ref, 'fitness.json'), undefined) }); write(join(P.run, 'guard.md'), g.text); console.log(g.text.trim()); process.exitCode = g.ok ? 0 : 1; break; }
    if (sub === 'close') { console.log(`stage 2 closed: ${closeGuard(docsDir)}`); break; }
    console.error('usage: arch guard <snapshot|verify|close> [root] --out <docsDir>'); process.exitCode = 2; break;
  }
  default: console.log('usage: arch <classify [--help-fold-rules]|extract <kind>|drift|check|run|guard <snapshot|verify|close>> [root] [--out <docsDir>] [--no-render] [--now YYYY-MM-DD] [--force]'); process.exitCode = 2;
}
