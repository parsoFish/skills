// House-style §3 required-view matrix for the 8 archetypes, and the CHECKLIST.md renderer.
// Requiredness levels, ranked: '✓' required > 'opt' optional > '—' not applicable.

export const VIEWS = [
  'context', 'component', 'deployment', 'scenarios', 'catalogue', 'api', 'module-graph',
  'adrs', 'risks', 'screen-flow', 'loop', 'device-topology', 'extension-points', 'signals',
  'pipeline', 'credential', 'deps', 'job-dag', 'data-contracts', 'tests', 'stakeholders', 'rules',
  'quality',
];

// Required for every archetype per house-style §3: "context+container, component+drift,
// pipeline, dependency ledger, ADRs+index, rule lint".
const BASE = new Set(['context', 'component', 'pipeline', 'deps', 'adrs', 'rules']);

const RANK = { '✓': 2, opt: 1, '—': 0 };

// Kind-specific additions beyond BASE. '✓' = named as required by house-style §3; 'opt' = good
// practice but not mandated for that kind. UI kinds (service, simulation, extension) get
// screen-flow per "UI kinds add the screen-flow map".
// quality (top-3 quality goals -> proving scenario -> guarding rule) is required for kinds with
// an operational surface worth protecting (service, iac, pipeline, hardware) and optional for the
// rest (cli/library, plugin, simulation, extension) — never "not applicable".
const KIND_TABLE = {
  cli: { api: '✓', 'screen-flow': 'opt', credential: 'opt', tests: 'opt', stakeholders: 'opt', risks: 'opt', quality: 'opt' },
  service: {
    deployment: '✓', scenarios: '✓', catalogue: 'opt', api: '✓', credential: '✓', signals: '✓',
    tests: '✓', risks: '✓', stakeholders: '✓', 'screen-flow': '✓', quality: '✓',
    'extension-points': 'opt', 'job-dag': 'opt',
  },
  iac: { 'module-graph': '✓', credential: '✓', risks: '✓', quality: '✓', deployment: 'opt', tests: 'opt', stakeholders: 'opt', signals: 'opt' },
  plugin: { 'extension-points': '✓', api: 'opt', 'screen-flow': 'opt', credential: 'opt', tests: 'opt', stakeholders: 'opt', risks: 'opt', quality: 'opt' },
  simulation: { loop: '✓', 'screen-flow': '✓', credential: 'opt', tests: 'opt', stakeholders: 'opt', signals: 'opt', risks: 'opt', quality: 'opt' },
  hardware: { loop: '✓', 'device-topology': '✓', signals: '✓', quality: '✓', credential: 'opt', tests: 'opt', stakeholders: 'opt', risks: 'opt' },
  pipeline: { 'job-dag': '✓', 'data-contracts': '✓', quality: '✓', catalogue: 'opt', signals: 'opt', tests: 'opt', stakeholders: 'opt', risks: 'opt' },
  extension: { 'screen-flow': '✓', 'extension-points': '✓', api: 'opt', credential: 'opt', tests: 'opt', stakeholders: 'opt', risks: 'opt', quality: 'opt' },
  // library shares CLI's required-view set per house-style's "CLI/library" archetype grouping.
  library: { api: 'opt', 'screen-flow': 'opt', credential: 'opt', tests: 'opt', stakeholders: 'opt', risks: 'opt', quality: 'opt' },
};

const REASONS = {
  deployment: 'no deployment target beyond source control',
  scenarios: 'no user-facing scenarios for this kind',
  catalogue: 'no schema or event catalogue for this kind',
  api: 'no HTTP or CLI surface',
  'module-graph': 'no Terraform modules',
  'screen-flow': 'no user-facing UI',
  loop: 'no tick loop',
  'extension-points': 'no extension registry',
  signals: 'no signals tracked for this kind',
  credential: 'no secrets to map',
  'job-dag': 'not a pipeline kind',
  'data-contracts': 'not a pipeline kind',
  tests: 'seam grid not required for this kind',
  stakeholders: 'stakeholder matrix not required for this kind',
  risks: 'risk register not required for this kind',
  'device-topology': 'not a hardware kind',
};

// "adrs" presence semantics: a directory existing is not evidence of a real decision log — an
// empty `decisions/` (or a lone generated README.md with zero ADRs under it) is not "present".
// A caller checking this view should require at least one *.md decision file beyond the
// generated index, not just existsSync on the directory.

// Per-view "what counts as present" shape, independent of which inode holds it, so a caller can
// check the actual content (a real diagram, the right columns) instead of just a path existing.
// needsFence: the generated doc is diagram-first — present only with a ```mermaid fence or an
// <svg> element, not prose. needsTableColumns: present only once a GFM table has all of these
// columns (by header name, case/punctuation-insensitive) with every row filled in.
const SHAPES = {
  context: { file: 'reference/views/index.png', needsFence: false, needsTableColumns: [] },
  component: { file: 'reference/components.md', needsFence: false, needsTableColumns: ['component', 'files', 'tests'] },
  deployment: { file: 'architecture/deployment.md', needsFence: true, needsTableColumns: [] },
  scenarios: { file: 'architecture/scenarios/', needsFence: true, needsTableColumns: [] },
  catalogue: { file: 'reference/events/', needsFence: false, needsTableColumns: [] },
  api: { file: 'reference/api.md', needsFence: false, needsTableColumns: [] },
  'module-graph': { file: 'reference/infra.md', needsFence: true, needsTableColumns: [] },
  adrs: { file: 'decisions/README.md', needsFence: false, needsTableColumns: [] },
  risks: { file: 'architecture/risks.md', needsFence: false, needsTableColumns: ['likelihood', 'impact', 'trigger', 'mitigation', 'owner'] },
  'screen-flow': { file: 'architecture/journeys/', needsFence: true, needsTableColumns: [] },
  loop: { file: 'architecture/loop.md', needsFence: true, needsTableColumns: [] },
  'device-topology': { file: 'architecture/deployment.md', needsFence: true, needsTableColumns: [] },
  'extension-points': { file: 'reference/extension-points.md', needsFence: false, needsTableColumns: ['name', 'glob', 'count', 'installed'] },
  signals: { file: 'architecture/signals.md', needsFence: true, needsTableColumns: [] },
  pipeline: { file: 'reference/delivery.md', needsFence: false, needsTableColumns: ['file', 'job', 'needs', 'runs-on', 'steps'] },
  credential: { file: 'architecture/secrets.md', needsFence: true, needsTableColumns: [] },
  deps: { file: 'reference/deps.md', needsFence: false, needsTableColumns: ['name', 'version', 'usedBy', 'why', 'unused'] },
  'job-dag': { file: 'reference/jobs.md', needsFence: false, needsTableColumns: ['source', 'file', 'job', 'schedule'] },
  'data-contracts': { file: 'reference/data/', needsFence: false, needsTableColumns: [] },
  tests: { file: 'reference/tests-by-seam.md', needsFence: false, needsTableColumns: ['seam', 'unit', 'contract', 'journey', 'ground'] },
  stakeholders: { file: 'architecture/stakeholders.md', needsFence: false, needsTableColumns: ['stakeholder', 'concern', 'view'] },
  rules: { file: 'reference/fitness.md', needsFence: false, needsTableColumns: ['id', 'ok', 'detail'] },
  quality: { file: 'architecture/quality.md', needsFence: false, needsTableColumns: ['goal', 'scenario', 'rule'] },
};

/** Which views a set of rendered PNGs satisfies, by the kit's fixed view ids: `index` is the context
 * view, `deployment` the deployment view. Pure; unknown PNGs satisfy nothing. */
export function presentFromViews(views = []) {
  const out = {};
  if (views.includes('index.png')) out.context = 'reference/views/index.png';
  if (views.includes('deployment.png')) out.deployment = 'reference/views/deployment.png';
  return out;
}

/** What counts as "present" for a view: its conventional path plus the shape a caller should check (a mermaid/svg fence, or specific table columns) rather than just an inode existing. Unknown views get an empty, unopinionated shape. */
export function viewShape(view) {
  const s = SHAPES[view];
  return s ? { ...s, needsTableColumns: [...s.needsTableColumns] } : { file: null, needsFence: false, needsTableColumns: [] };
}

/** Union the required-view matrix across every classified kind; unknown kinds contribute nothing. */
export function requiredViews(kinds) {
  const list = Array.isArray(kinds) ? kinds : [];
  return VIEWS.map(view => {
    let required = BASE.has(view) ? '✓' : '—';
    for (const kind of list) {
      const level = KIND_TABLE[kind]?.[view];
      if (level && RANK[level] > RANK[required]) required = level;
    }
    return { view, required };
  });
}

/**
 * present: { [view]: true | 'partial' | string(path) | falsy }. A string marks the view present
 * and is shown in the `where` column. Absent-but-required renders MISSING (never a blank cell) so
 * arch check's blank-row rule catches it; absent-but-opt/not-applicable renders n/a with a reason.
 */
export function checklistMd(kinds, present = {}) {
  const rows = requiredViews(kinds);
  const lines = ['| view | status | where |', '|---|---|---|'];
  for (const { view, required } of rows) {
    const p = present[view];
    let status = '';
    let where = '';
    if (p === true) status = '✓';
    else if (p === 'partial') status = 'partial';
    else if (typeof p === 'string' && p) { status = '✓'; where = p; }
    else if (required === '✓') status = 'MISSING';
    else if (required === 'opt') status = 'n/a: optional for this kind';
    else status = `n/a: ${REASONS[view] ?? 'not required for this kind'}`;
    lines.push(`| ${view} | ${status} | ${where} |`);
  }
  return `${lines.join('\n')}\n`;
}
