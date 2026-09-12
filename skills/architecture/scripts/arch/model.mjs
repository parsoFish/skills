// Build LikeC4 model text: the fixed legend, the generated component model, and a hand.c4 seed.
// Pure string builders — no fs writes here; the caller decides whether/where to write.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LEGEND_PATH = join(here, '..', '..', 'assets', 'legend.c4');
const DESCRIPTION_MAX = 90;

/** The house legend, read fresh each call so edits to legend.c4 are always reflected. */
export function specC4() {
  return readFileSync(LEGEND_PATH, 'utf8');
}

export function sanitizeId(id) {
  const s = String(id).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(s) ? `c_${s}` : (s || 'x');
}

function q(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function capDescription(s) {
  const str = String(s);
  return str.length > DESCRIPTION_MAX ? `${str.slice(0, DESCRIPTION_MAX - 1)}…` : str;
}

// Kind heuristics, first match wins, checked against the id then (if given) each path in `files`.
// Order matters: a component named "web-agent" reads as webui, not agent.
const KIND_PATTERNS = [
  { re: /(^|[-_])(ui|web|app|studio|frontend|site|dashboard)/i, kind: 'webui' },
  { re: /(cli|bin|cmd|tool)/i, kind: 'cli' },
  { re: /(agent|bot|llm|worker)/i, kind: 'agent' },
  { re: /(db|store|storage|brain|knowledge|repo|cache)/i, kind: 'knowledge' },
  { re: /(log|events?|audit|ledger)/i, kind: 'log' },
  { re: /(infra|terraform|deploy)/i, kind: 'iacmodule' },
];

/**
 * Guess a LikeC4 kind from a component id (and, failing that, its file paths) so an ungrouped
 * component reads as something more specific than the "service" default. Never returns anything
 * outside the fixed house kind vocabulary — the last resort is always 'service'.
 */
export function inferKind(id, files = []) {
  const hay = String(id ?? '');
  for (const { re, kind } of KIND_PATTERNS) if (re.test(hay)) return kind;
  for (const f of files ?? []) {
    const path = String(f);
    for (const { re, kind } of KIND_PATTERNS) if (re.test(path)) return kind;
  }
  return 'service';
}

/**
 * Render the generated component model: one `<kind> <id> '<title>' { description? technology '<n>
 * files' }` per component, plus edges qualified under the system id. Edge kind is `imports` above
 * minorEdgeThreshold (count carried as relationship metadata, never as the title) else `minor`
 * (untitled). Kind defaults to a heuristic guess (`inferKind`) rather than a flat 'service' so an
 * ungrouped component still reads as something specific in the rendered legend.
 */
export function generatedC4(components, opts = {}) {
  const { minorEdgeThreshold = 5, kinds = {}, titles = {}, descriptions = {}, systemId = 'system', systemTitle } = opts;
  const sysId = sanitizeId(systemId);
  const nodes = components?.nodes ?? [];
  const edges = components?.edges ?? [];
  const nodeLines = nodes.map(n => {
    const id = sanitizeId(n.id);
    const kind = kinds[n.id] ?? inferKind(n.id);
    const title = titles[n.id] ?? n.id;
    const desc = descriptions[n.id];
    const body = [
      ...(desc ? [`      description ${q(capDescription(desc))}`] : []),
      `      technology ${q(`${n.files} files`)}`,
    ];
    return `    ${kind} ${id} ${q(title)} {\n${body.join('\n')}\n    }`;
  });
  const edgeLines = edges.map(e => {
    const from = sanitizeId(e.from);
    const to = sanitizeId(e.to);
    return e.count >= minorEdgeThreshold
      ? [
          `  ${sysId}.${from} -[imports]-> ${sysId}.${to} {`,
          '    metadata {',
          `      count ${q(e.count)}`,
          '    }',
          '  }',
        ].join('\n')
      : `  ${sysId}.${from} -[minor]-> ${sysId}.${to}`;
  });
  return [
    'model {',
    `  system ${sysId} ${q(systemTitle ?? systemId)} {`,
    ...nodeLines,
    '  }',
    ...edgeLines,
    '}',
    '',
  ].join('\n');
}

// Each external carries how it relates to the system as a whole for the context view: `to` means
// the external initiates (external -> system), `from` means the system initiates (system -> external).
const EXTERNALS_BASE = [
  { id: 'operator', elementKind: 'human', title: 'Human operator', rel: { direction: 'to', verb: 'uses' } },
  { id: 'github', elementKind: 'external', title: 'GitHub', rel: { direction: 'from', verb: 'reads/writes' } },
  { id: 'workspace', elementKind: 'workspace', title: 'Workspace', rel: { direction: 'from', verb: 'reads/writes' } },
  { id: 'log', elementKind: 'log', title: 'Log', rel: { direction: 'from', verb: 'writes' } },
];
const MODEL_API = { id: 'modelapi', elementKind: 'modelapi', title: 'Model API', rel: { direction: 'from', verb: 'calls' } };

const resolvedKind = (id, kindsOverride) => kindsOverride[id] ?? inferKind(id);

/** Only add the modelapi external when a real folded component resolves to kind 'agent' — the
 * project's overall archetype (classify.mjs's vocabulary has no 'agent' at all) is not a signal. */
function externalsFor(components, kindsOverride) {
  const hasAgent = (components?.nodes ?? []).some(n => resolvedKind(n.id, kindsOverride) === 'agent');
  return hasAgent ? [...EXTERNALS_BASE, MODEL_API] : EXTERNALS_BASE;
}

function systemRelLines(sysId, externals) {
  return externals.map(e => (e.rel.direction === 'to' ? `  ${e.id} -> ${sysId} ${q(e.rel.verb)}` : `  ${sysId} -> ${e.id} ${q(e.rel.verb)}`));
}

function heaviestEdges(components, n) {
  return [...(components?.edges ?? [])].sort((a, b) => b.count - a.count).slice(0, n);
}

function areaViewBlock(sysId, name, ids) {
  const included = ids.map(id => `${sysId}.${sanitizeId(id)}`).join(', ');
  return [
    `  view ${sanitizeId(`area_${name}`)} of ${sysId} {`,
    `    title ${q(name)}`,
    `    description ${q(`which components make up the ${name} area`)}`,
    `    include ${included}`,
    '    exclude * -> * where kind is minor',
    '  }',
  ];
}

/**
 * Seed docs/architecture/model/hand.c4: externals (plus a model API endpoint when a component
 * actually resolves to kind 'agent'), system-level relationships to each external so the context
 * view has edges (a relationship into an excluded child never renders — see house-style §context),
 * and the house-style views: context, containers (top 8 by files), components, one view per
 * `opts.areas` group, and a dynamic main-path view from the heaviest edges. Never overwrites an
 * existing hand.c4 — that decision belongs to the caller; this only builds text.
 */
export function seedHandC4(components, opts = {}) {
  const { systemId = 'system', kinds = {}, areas = {} } = opts;
  const sysId = sanitizeId(systemId);
  const externals = externalsFor(components, kinds);
  const extLines = externals.map(e => `  ${e.elementKind} ${e.id} ${q(e.title)}`);
  const modelBlock = ['model {', ...extLines, '', ...systemRelLines(sysId, externals), '}'].join('\n');

  const kindOf = n => kinds[n.id] ?? inferKind(n.id);
  const distinct = [...(components?.nodes ?? [])].filter(n => kindOf(n) !== 'service');
  const bySize = [...(components?.nodes ?? [])].sort((a, b) => (b.files ?? 0) - (a.files ?? 0) || a.id.localeCompare(b.id));
  const top = [...new Map([...distinct, ...bySize].map(n => [n.id, n])).values()]
    .slice(0, 8)
    .map(n => `${sysId}.${sanitizeId(n.id)}`);

  const excludeExternals = externals.map(e => e.id).join(', ');
  const heavy = heaviestEdges(components, 2).map(e => `  ${sysId}.${sanitizeId(e.from)} -> ${sysId}.${sanitizeId(e.to)} 'imports'`);
  const areaViews = Object.entries(areas).flatMap(([name, ids]) => ((ids ?? []).length ? areaViewBlock(sysId, name, ids) : []));

  const viewsBlock = [
    'views {',
    '  view index {',
    "    title 'Context'",
    "    description 'who and what surrounds the system'",
    '    include *',
    `    exclude ${sysId}.*`,
    '  }',
    `  view containers of ${sysId} {`,
    "    title 'Containers'",
    "    description 'the main runtime parts and how they talk'",
    top.length ? `    include ${top.join(', ')}` : '    include *',
    '    exclude * -> * where kind is minor',
    '  }',
    `  view components of ${sysId} {`,
    "    title 'Components'",
    "    description 'production imports between parts, minor edges omitted'",
    '    include *',
    '    exclude * -> * where kind is minor',
    excludeExternals ? `    exclude ${excludeExternals}` : '',
    '  }',
    ...areaViews,
    ...(heavy.length ? ['  dynamic view mainPath {', "    title 'Main path'", "    description 'the busiest import path through the system'", ...heavy, '  }'] : []),
    '}',
    '',
  ].filter(l => l !== '');

  return `${modelBlock}\n\n${viewsBlock.join('\n')}`;
}
