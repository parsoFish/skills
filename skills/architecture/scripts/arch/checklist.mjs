// House-style §3 required-view matrix for the 8 archetypes, and the CHECKLIST.md renderer.
// Requiredness levels, ranked: '✓' required > 'opt' optional > '—' not applicable.

export const VIEWS = [
  'context', 'component', 'deployment', 'scenarios', 'catalogue', 'api', 'module-graph',
  'adrs', 'risks', 'screen-flow', 'loop', 'device-topology', 'extension-points', 'signals',
  'pipeline', 'credential', 'deps', 'job-dag', 'data-contracts', 'tests', 'stakeholders', 'rules',
];

// Required for every archetype per house-style §3: "context+container, component+drift,
// pipeline, dependency ledger, ADRs+index, rule lint".
const BASE = new Set(['context', 'component', 'pipeline', 'deps', 'adrs', 'rules']);

const RANK = { '✓': 2, opt: 1, '—': 0 };

// Kind-specific additions beyond BASE. '✓' = named as required by house-style §3; 'opt' = good
// practice but not mandated for that kind. UI kinds (service, simulation, extension) get
// screen-flow per "UI kinds add the screen-flow map".
const KIND_TABLE = {
  cli: { api: '✓', 'screen-flow': 'opt', credential: 'opt', tests: 'opt', stakeholders: 'opt', risks: 'opt' },
  service: {
    deployment: '✓', scenarios: '✓', catalogue: '✓', api: '✓', credential: '✓', signals: '✓',
    tests: '✓', risks: '✓', stakeholders: '✓', 'screen-flow': '✓',
    'extension-points': 'opt', 'job-dag': 'opt',
  },
  iac: { 'module-graph': '✓', credential: '✓', risks: '✓', deployment: 'opt', tests: 'opt', stakeholders: 'opt', signals: 'opt' },
  plugin: { 'extension-points': '✓', api: 'opt', 'screen-flow': 'opt', credential: 'opt', tests: 'opt', stakeholders: 'opt', risks: 'opt' },
  simulation: { loop: '✓', 'screen-flow': '✓', credential: 'opt', tests: 'opt', stakeholders: 'opt', signals: 'opt', risks: 'opt' },
  hardware: { loop: '✓', 'device-topology': '✓', signals: '✓', credential: 'opt', tests: 'opt', stakeholders: 'opt', risks: 'opt' },
  pipeline: { 'job-dag': '✓', 'data-contracts': '✓', catalogue: 'opt', signals: 'opt', tests: 'opt', stakeholders: 'opt', risks: 'opt' },
  extension: { 'screen-flow': '✓', 'extension-points': '✓', api: 'opt', credential: 'opt', tests: 'opt', stakeholders: 'opt', risks: 'opt' },
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
