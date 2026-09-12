// Build LikeC4 model text: the fixed legend, the generated component model, and a hand.c4 seed.
// Pure string builders — no fs writes here; the caller decides whether/where to write.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LEGEND_PATH = join(here, '..', '..', 'assets', 'legend.c4');

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

/**
 * Render the generated component model: one `<kind> <id> '<title>' { technology '<n> files' }`
 * per component, plus edges qualified under the system id. Edge kind is `imports` (titled with
 * the count) at/above minorEdgeThreshold, else `minor` (untitled).
 */
export function generatedC4(components, opts = {}) {
  const { minorEdgeThreshold = 5, kinds = {}, titles = {}, systemId = 'system', systemTitle } = opts;
  const sysId = sanitizeId(systemId);
  const nodes = components?.nodes ?? [];
  const edges = components?.edges ?? [];
  const nodeLines = nodes.map(n => {
    const id = sanitizeId(n.id);
    const kind = kinds[n.id] ?? 'service';
    const title = titles[n.id] ?? n.id;
    return `    ${kind} ${id} ${q(title)} {\n      technology ${q(`${n.files} files`)}\n    }`;
  });
  const edgeLines = edges.map(e => {
    const from = sanitizeId(e.from);
    const to = sanitizeId(e.to);
    return e.count >= minorEdgeThreshold
      ? `  ${sysId}.${from} -[imports]-> ${sysId}.${to} ${q(e.count)}`
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

const EXTERNALS_BASE = [
  { id: 'operator', elementKind: 'human', title: 'Human operator' },
  { id: 'github', elementKind: 'external', title: 'GitHub' },
  { id: 'workspace', elementKind: 'workspace', title: 'Workspace' },
  { id: 'log', elementKind: 'log', title: 'Log' },
];

function externalsFor(kind) {
  return kind === 'agent'
    ? [...EXTERNALS_BASE, { id: 'modelapi', elementKind: 'modelapi', title: 'Model API' }]
    : EXTERNALS_BASE;
}

function firstUiComponent(components) {
  const nodes = components?.nodes ?? [];
  return nodes.find(n => /ui|cli|app/i.test(n.id)) ?? nodes[0] ?? null;
}

function heaviestEdges(components, n) {
  return [...(components?.edges ?? [])].sort((a, b) => b.count - a.count).slice(0, n);
}

/**
 * Seed docs/architecture/model/hand.c4: externals for the kind, an operator relationship into
 * the first UI/CLI-like component, and the four house-style views. Never overwrites an existing
 * hand.c4 — that decision belongs to the caller; this only builds text.
 */
export function seedHandC4(components, opts = {}) {
  const { systemId = 'system', kind = 'service' } = opts;
  const sysId = sanitizeId(systemId);
  const externals = externalsFor(kind);
  const extLines = externals.map(e => `  ${e.elementKind} ${e.id} ${q(e.title)}`);
  const ui = firstUiComponent(components);
  const relLines = ui ? [`  operator -> ${sysId}.${sanitizeId(ui.id)} 'uses'`] : [];
  const modelBlock = ['model {', ...extLines, '', ...relLines, '}'].join('\n');

  const top = [...(components?.nodes ?? [])]
    .sort((a, b) => (b.files ?? 0) - (a.files ?? 0) || a.id.localeCompare(b.id))
    .slice(0, 12)
    .map(n => `${sysId}.${sanitizeId(n.id)}`);

  const excludeExternals = externals.map(e => e.id).join(', ');
  const heavy = heaviestEdges(components, 2).map(e => `  ${sysId}.${sanitizeId(e.from)} -> ${sysId}.${sanitizeId(e.to)} 'imports'`);

  const viewsBlock = [
    'views {',
    '  view index {',
    "    title 'Context'",
    '    include *',
    `    exclude ${sysId}.*`,
    '  }',
    `  view containers of ${sysId} {`,
    "    title 'Containers'",
    top.length ? `    include ${top.join(', ')}` : '    include *',
    '  }',
    `  view components of ${sysId} {`,
    "    title 'Components'",
    '    include *',
    '    exclude * -> * where kind is minor',
    excludeExternals ? `    exclude ${excludeExternals}` : '',
    '  }',
    ...(heavy.length ? ['  dynamic view mainPath {', "    title 'Main path'", ...heavy, '  }'] : []),
    '}',
    '',
  ].filter(l => l !== '');

  return `${modelBlock}\n\n${viewsBlock.join('\n')}`;
}
