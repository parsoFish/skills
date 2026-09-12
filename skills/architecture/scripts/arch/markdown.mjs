// Render extractor JSON into the house-style markdown: a generated header, an H1, one line of
// meaning, then tables with red-flag rows first, capped at 60 rows. Deterministic, no lib.

const ROW_CAP = 60;

/** GFM table from headers + row arrays; caps at 60 rows and appends "... N more" below. */
export function table(headers, rows) {
  const shown = rows.slice(0, ROW_CAP);
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const r of shown) lines.push(`| ${r.map(c => String(c ?? '')).join(' | ')} |`);
  let out = lines.join('\n');
  if (rows.length > ROW_CAP) out += `\n\n… ${rows.length - ROW_CAP} more`;
  return out;
}

const META = {
  deps: { title: 'Dependencies', command: 'extract deps' },
  delivery: { title: 'Delivery', command: 'extract delivery' },
  'ext-points': { title: 'Extension Points', command: 'extract ext-points' },
  api: { title: 'API Surface', command: 'extract api' },
  tests: { title: 'Tests', command: 'extract tests' },
  env: { title: 'Environment', command: 'extract env' },
  ui: { title: 'UI Anchors', command: 'extract ui' },
  components: { title: 'Components', command: 'extract components' },
  drift: { title: 'Drift', command: 'drift' },
  fitness: { title: 'Fitness', command: 'check' },
};

function depsBody(json) {
  const rows = [...json.deps].sort((a, b) => (a.unused === b.unused ? 0 : a.unused ? -1 : 1));
  const body = ['One row per direct runtime dependency; unused deps sort first.', '',
    table(['name', 'version', 'usedBy', 'why', 'unused'], rows.map(d => [d.name, d.version, d.usedBy.join(', '), d.why, d.unused ? 'yes' : ''])),
    '', `lockfile: ${json.lockfile ?? 'none'}`];
  if (json.notes?.length) body.push('', ...json.notes.map(n => `- ${n}`));
  return body.join('\n');
}

function deliveryBody(json) {
  const flagged = [], rest = [];
  for (const wf of json.workflows) {
    const ids = new Set((wf.jobs ?? []).map(j => j.id));
    for (const j of wf.jobs ?? []) {
      const row = [wf.file, j.id, (j.needs ?? []).join(', '), j.runsOn, String((j.steps ?? []).length)];
      ((j.needs ?? []).some(n => !ids.has(n)) ? flagged : rest).push(row);
    }
  }
  const body = ['One row per job; jobs whose `needs` names a missing job sort first.', '', table(['file', 'job', 'needs', 'runs-on', 'steps'], [...flagged, ...rest])];
  if (json.notes?.length) body.push('', ...json.notes.map(n => `- ${n}`));
  return body.join('\n');
}

function extPointsBody(json) {
  const rows = [...json.points].sort((a, b) => (a.count === 0) === (b.count === 0) ? 0 : a.count === 0 ? -1 : 1);
  return ['One row per registry glob; empty registries sort first.', '',
    table(['name', 'glob', 'count', 'installed'], rows.map(p => [p.name, p.glob, String(p.count), p.installed.join(', ')]))].join('\n');
}

function apiBody(json) {
  if (json.source === 'openapi') return ['Single OpenAPI document is the source of truth.', '', table(['file', 'pathCount'], [[json.file, String(json.pathCount)]])].join('\n');
  const body = ['Route literals found in production code, grouped by first segment after /api/.', '',
    table(['group', 'count'], json.groups.map(g => [g.group, String(g.count)])),
    '', '### by owning directory', '', table(['dir', 'count'], json.byOwner.map(o => [o.dir, String(o.count)])),
    '', `${json.paths.length} distinct literal path(s)`];
  if (json.notes?.length) body.push('', ...json.notes.map(n => `- ${n}`));
  return body.join('\n');
}

function testsBody(json) {
  const seamRows = [...json.tagged.seams].sort((a, b) => {
    const az = Object.values(a.layers).every(v => v === 0), bz = Object.values(b.layers).every(v => v === 0);
    return az === bz ? a.seam.localeCompare(b.seam) : az ? -1 : 1;
  });
  return [`${json.total} test file(s) across ${json.byDir.length} top-level dir(s); untagged seams sort first.`, '',
    table(['dir', 'count'], json.byDir.map(d => [d.dir, String(d.count)])),
    '', table(['seam', 'unit', 'contract', 'journey', 'ground'], seamRows.map(s => [s.seam, s.layers.unit, s.layers.contract, s.layers.journey, s.layers.ground])),
    '', `tagging adopted: ${json.taggingAdopted ? 'yes' : 'no'}`].join('\n');
}

function envBody(json) {
  const secret = new Set(json.secretLike);
  const rows = [...json.vars].sort((a, b) => (secret.has(a.name) === secret.has(b.name) ? 0 : secret.has(a.name) ? -1 : 1));
  return ['One row per env var read in production code; secret-like names sort first.', '',
    table(['name', 'count', 'sites', 'secretLike'], rows.map(v => [v.name, String(v.count), v.sites.join('; '), secret.has(v.name) ? 'yes' : '']))].join('\n');
}

function uiBody(json) {
  return ['One row per discovered UI route.', '', table(['route', 'file'], json.routes.map(r => [r.route, r.file])),
    '', `${json.dataAttributes.count} distinct data-* attribute(s): ${json.dataAttributes.names.join(', ')}`].join('\n');
}

function componentsBody(json) {
  const cycles = json.cycles ?? [];
  const body = [`${cycles.length} import cycle(s); cycles sort first.`, ''];
  if (cycles.length) body.push(table(['a', 'b', 'a→b', 'b→a'], cycles.map(c => [c.a, c.b, String(c.ab), String(c.ba)])), '');
  body.push(table(['component', 'files', 'tests'], (json.nodes ?? []).map(n => [n.id, String(n.files), String(n.tests)])));
  return body.join('\n');
}

function driftBody(json) {
  return [`verdict: ${json.unexplained === 0 ? 'clean' : json.unexplained + ' unexplained edge(s)'}`, '',
    '### hand claims code does not show', '', table(['from', 'to'], json.edges.inHandNotCode.map(e => [e.from, e.to])),
    '', '### code shows, hand does not claim', '', table(['from', 'to', 'count'], json.edges.inCodeNotHand.map(e => [e.from, e.to, String(e.count)])),
    '', '### nodes', '', table(['change', 'id'], [
      ...json.nodes.added.map(id => ['added', id]),
      ...json.nodes.removed.map(id => ['removed', id]),
      ...json.nodes.renamed.map(r => ['renamed', `${r.from} → ${r.to}`]),
    ])].join('\n');
}

function fitnessBody(json) {
  const failing = json.results.filter(r => !r.ok), passing = json.results.filter(r => r.ok);
  return [`verdict: ${json.ok ? 'all rules pass' : failing.length + ' rule(s) failing'}`, '',
    table(['id', 'ok', 'detail'], [...failing, ...passing].map(r => [r.id, r.ok ? 'yes' : 'no', (r.detail ?? []).slice(0, 3).join(', ')]))].join('\n');
}

const BODIES = { deps: depsBody, delivery: deliveryBody, 'ext-points': extPointsBody, api: apiBody, tests: testsBody, env: envBody, ui: uiBody, components: componentsBody, drift: driftBody, fitness: fitnessBody };

/** Markdown for one kit artifact kind: header, H1, one meaning line, then red-flags-first tables. */
export function toMarkdown(kind, json, { command } = {}) {
  const meta = META[kind];
  if (!meta) throw new Error(`toMarkdown: unknown kind "${kind}"`);
  const header = `generated by arch ${command ?? meta.command} — do not hand-edit`;
  return `${header}\n\n# ${meta.title}\n\n${BODIES[kind](json)}\n`;
}
