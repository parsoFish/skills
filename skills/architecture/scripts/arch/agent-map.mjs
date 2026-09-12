// AGENTS-ARCH.md: a compact, agent-facing digest of the kit's own findings — which component owns
// which paths, what it may/must not import, which fitness rules hold, and where that comes from
// (a git sha). Everything here is a join over data the kit already computed (components.json,
// drift.json, fitness.json) plus one read-only re-walk of the source tree, using the exact same
// fold rules stage 1 used, so `paths` cites real files rather than guessing at a templated rule's
// output. Pure builder — no fs writes; the caller decides whether/where to save the markdown.
import { execFileSync } from 'node:child_process';
import { extractImports } from './extract-imports.mjs';
import { componentOf, DEFAULT_TEST_PATTERN } from './fold.mjs';
import { inferKind } from './model.mjs';

const ROW_CAP = 50;
const RULE_LIST_CAP = 20;
const GAP_CAP = 5;

function gitSha(root) {
  if (!root) return null;
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return null; }
}

/** rules: either the plain [{match,component}] array, or the whole fold-rules.json shape. */
function normalizeRules(rules) {
  if (Array.isArray(rules)) return { list: rules, ignore: undefined, include: undefined };
  if (rules && Array.isArray(rules.rules)) return { list: rules.rules, ignore: rules.scanIgnore, include: rules.include };
  return { list: [], ignore: undefined, include: undefined };
}

// Compile keeping the rule's original match text (fold.mjs's own compile() only keeps the
// compiled RegExp, whose .source escapes '/' — not what a human-facing "owns" column should show).
function compileKeepingRaw(rules) {
  return rules.map(r => ({ re: r.match instanceof RegExp ? r.match : new RegExp(r.match), component: r.component, raw: r.match instanceof RegExp ? r.match.source : String(r.match) }));
}

/**
 * Real per-file provenance: id -> Set<rule match text> for every rule that actually placed a
 * file into that component, re-derived by re-walking root with the same rules stage 1 used.
 * Never throws: a missing root, an unreadable tree, or an empty ruleset all just yield no paths.
 */
function attributePaths(root, rules, { ignore, include } = {}) {
  const byComponent = new Map();
  const { list, ignore: cfgIgnore, include: cfgInclude } = normalizeRules(rules);
  if (!root || !list.length) return byComponent;
  const compiled = compileKeepingRaw(list);
  let graph;
  try { graph = extractImports(root, { ignore: ignore ?? cfgIgnore ?? [], include: include ?? cfgInclude ?? null }); }
  catch { return byComponent; }
  for (const mod of graph.modules ?? []) {
    if (DEFAULT_TEST_PATTERN.test(mod.source)) continue;
    const id = componentOf(mod.source, compiled);
    if (!id) continue;
    const rule = compiled.find(r => r.re.test(mod.source));
    if (!byComponent.has(id)) byComponent.set(id, new Set());
    if (rule) byComponent.get(id).add(rule.raw);
  }
  return byComponent;
}

function seamsList(seams) {
  return seams?.tagged?.seams ?? seams?.seams ?? [];
}

/** Test evidence for a component, matched by seam name (case-insensitive); null when there is none. */
function provenBy(id, seams) {
  const hit = seamsList(seams).find(s => String(s.seam).toLowerCase() === String(id).toLowerCase());
  if (!hit) return null;
  const layers = Object.entries(hit.layers ?? {}).filter(([, n]) => n && n !== 0).map(([layer, n]) => `${layer}:${n}`);
  return layers.length ? layers.join(' ') : null;
}

/**
 * buildAgentMap({ components, drift, fitness, rules, seams?, kinds, root }) — join the kit's own
 * artifacts into one agent-facing map. `components`/`drift`/`fitness` are this run's JSON
 * (components.json/drift.json/fitness.json shapes); `rules` is fold-rules.json (or its plain
 * `.rules` array); `kinds` is the id -> LikeC4 kind override (fold-rules.json's `kinds`, same
 * fallback to `inferKind` that model.mjs uses); `seams` is tests-by-seam.json, optional; `root` is
 * the source checkout, used to attribute real files to components and to stamp `generatedFrom`.
 */
export function buildAgentMap({ components, drift, fitness, rules = [], seams, kinds = {}, root, ignore, include } = {}) {
  const nodes = components?.nodes ?? [];
  const edges = components?.edges ?? [];
  const cycles = components?.cycles ?? [];
  const attributed = attributePaths(root, rules, { ignore, include });

  const importsOf = new Map(nodes.map(n => [n.id, []]));
  const importedByOf = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    if (importsOf.has(e.from)) importsOf.get(e.from).push(e.to);
    if (importedByOf.has(e.to)) importedByOf.get(e.to).push(e.from);
  }

  const forbidden = [];
  for (const c of cycles) {
    forbidden.push({ from: c.a, to: c.b, reason: `import cycle (${c.a}<->${c.b})` });
    forbidden.push({ from: c.b, to: c.a, reason: `import cycle (${c.a}<->${c.b})` });
  }
  for (const e of drift?.edges?.undeclared ?? []) forbidden.push({ from: e.from, to: e.to, reason: 'undeclared in the hand model' });

  const componentsOut = nodes.map(n => ({
    id: n.id,
    kind: kinds[n.id] ?? inferKind(n.id),
    files: n.files ?? 0,
    paths: [...(attributed.get(n.id) ?? [])].sort(),
    imports: [...(importsOf.get(n.id) ?? [])].sort(),
    importedBy: [...(importedByOf.get(n.id) ?? [])].sort(),
    provenBy: provenBy(n.id, seams),
  })).sort((a, b) => a.id.localeCompare(b.id));

  return {
    components: componentsOut,
    forbidden,
    cycles,
    rules: (fitness?.results ?? []).map(r => ({ id: r.id, ok: r.ok })),
    generatedFrom: gitSha(root),
  };
}

const fmtList = arr => (arr.length ? arr.join(', ') : '—');
const capList = (arr, cap) => (arr.length > cap ? [...arr.slice(0, cap), `… ${arr.length - cap} more`] : arr);

/** ≤80-line markdown digest meant to be saved as AGENTS-ARCH.md: machine keys first (the table),
 * then the fitness rules that hold, then the 5 most important gaps (cycles, failing rules,
 * undeclared edges — in that order). Row/list counts are capped so a large project still fits. */
export function agentMapMd(map) {
  const lines = ['# AGENTS-ARCH.md', '', 'generated by arch agent-map — do not hand-edit', '', `sha: ${map.generatedFrom ?? 'unknown'}`, ''];

  lines.push('| component | owns | may import | must not import | proven by |', '|---|---|---|---|---|');
  for (const c of (map.components ?? []).slice(0, ROW_CAP)) {
    const forbiddenTo = map.forbidden.filter(f => f.from === c.id).map(f => f.to);
    const mayImport = c.imports.filter(i => !forbiddenTo.includes(i));
    lines.push(`| ${c.id} | ${fmtList(c.paths)} | ${fmtList(mayImport)} | ${fmtList(forbiddenTo)} | ${c.provenBy ?? '—'} |`);
  }
  if ((map.components ?? []).length > ROW_CAP) lines.push(`| … ${map.components.length - ROW_CAP} more | | | | |`);
  lines.push('');

  const holding = (map.rules ?? []).filter(r => r.ok).map(r => r.id);
  lines.push(`## Rules that hold (${holding.length}/${(map.rules ?? []).length})`, '');
  lines.push(holding.length ? capList(holding, RULE_LIST_CAP).map(id => `- ${id}`).join('\n') : '_none_', '');

  const gaps = [
    ...(map.cycles ?? []).map(c => `import cycle: ${c.a} <-> ${c.b} (${c.ab}/${c.ba} imports)`),
    ...(map.rules ?? []).filter(r => !r.ok).map(r => `rule failing: ${r.id}`),
    ...(map.forbidden ?? []).filter(f => f.reason === 'undeclared in the hand model').map(f => `undeclared: ${f.from} -> ${f.to}`),
  ].slice(0, GAP_CAP);
  lines.push('## Top gaps', '', gaps.length ? gaps.map(g => `- ${g}`).join('\n') : '_none_', '');

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
