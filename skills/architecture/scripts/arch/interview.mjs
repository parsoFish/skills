// Turn stage-1/stage-2 findings into classified gaps, then render the interview, kit-issues, and
// project-changes markdown per references/interview.md. Pure text builders; no fs writes.
import { existsSync, readFileSync } from 'node:fs';

const LETTERS = ['a', 'b', 'c', 'd'];
const optionsLine = options => options.map((o, i) => `(${LETTERS[i]}) ${o}`).join(' · ');

function gap({ id, class: cls, title, finding, evidence = [], options = [], default: def, changes = [] }) {
  return { id, class: cls, title, finding, evidence, options, default: def, changes };
}

function unusedDepEntries(deps) {
  if (Array.isArray(deps?.unused)) return deps.unused;
  return (deps?.deps ?? deps?.items ?? []).filter(d => d.unused).map(d => d.name);
}
function missingWhyEntries(deps) {
  if (Array.isArray(deps?.missingWhy)) return deps.missingWhy;
  return (deps?.deps ?? deps?.items ?? []).filter(d => !d.why && !d.unused).map(d => d.name);
}

// One gap builder per rule in the spec. Grouped by output class, in the order buildGaps applies them.
const GAPS = {
  kindAmbiguous: classify => gap({
    id: 'kind-ambiguous', class: 'human', title: 'Which archetype is this project?',
    finding: `Classification found ${classify.kinds.length} plausible archetypes: ${classify.kinds.join(', ')}.`,
    evidence: classify.evidence ?? [], options: classify.kinds.slice(0, 4).map(k => `treat as ${k}`),
    default: `treat as ${classify.kinds[0]}`, changes: ['docs/architecture/CHECKLIST.md', 'docs/architecture/fold-rules.json'],
  }),
  importCycle: c => gap({
    id: `import-cycle-${c.a}-${c.b}`, class: 'human', title: `Import cycle between ${c.a} and ${c.b}`,
    finding: `${c.a} <-> ${c.b}: ${c.ab} imports one way, ${c.ba} the other.`,
    evidence: [`docs/reference/components.json cycles: ${c.a}<->${c.b}`],
    options: ['accept-by-ADR', 'split-light', 'split-all'], default: 'accept-by-ADR', changes: ['docs/decisions/'],
  }),
  drift: e => gap({
    id: `drift-unexplained-${e.from}-${e.to}`, class: 'human', title: `Hand model claims ${e.from} -> ${e.to}, code disagrees`,
    finding: `The hand model declares ${e.from} -> ${e.to} but no such import was found in code.`,
    evidence: [`docs/reference/drift.json edges.inHandNotCode: ${e.from}->${e.to}`],
    options: ['fix hand model', 'add runtime tag', 'accept via ADR'], default: 'fix hand model', changes: ['docs/architecture/model/hand.c4'],
  }),
  depsMissingWhy: names => gap({
    id: 'deps-missing-why', class: 'human', title: 'Some dependencies have no recorded why',
    finding: `${names.length} dependencies have no why on file: ${names.join(', ')}.`, evidence: ['docs/reference/deps.md'],
    options: ['write a why for each', 'accept "no rationale on file" for all'],
    default: 'accept "no rationale on file" for all', changes: ['docs/reference/deps.md'],
  }),
  completeness: (file, c) => gap({
    id: `completeness-${file}-${c.id}`, class: 'human', title: `${file}: ${c.id} is unmet`,
    finding: `Completeness check ${c.id} failed${c.detail?.length ? ': ' + c.detail.join(', ') : '.'}`,
    evidence: [`docs/architecture/_run/completeness.json ${c.id}`],
    options: ['fix the register now', 'record as an accepted gap'], default: 'record as an accepted gap', changes: [`docs/architecture/${file}`],
  }),
  depsUnused: name => gap({
    id: `deps-unused-${name}`, class: 'project', title: `Dependency ${name} has no production import site`,
    finding: `${name} is declared but never imported from production code.`, evidence: ['docs/reference/deps.json'],
    options: ['remove it', 'keep with a documented why'], default: 'remove it', changes: ['package.json', 'docs/reference/deps.md'],
  }),
  apiLiterals: () => gap({
    id: 'api-source-literals', class: 'project', title: 'API surface has no schema',
    finding: 'The API extractor fell back to grouping route literals; there is no OpenAPI (or equivalent) schema to generate from.',
    evidence: ['docs/reference/api.json source: literals'],
    options: ['add an OpenAPI/schema source', 'accept literal grouping'], default: 'accept literal grouping', changes: ['docs/reference/api.md'],
  }),
  taggingNotAdopted: () => gap({
    id: 'tests-tagging-not-adopted', class: 'project', title: 'Tests are not seam/layer tagged',
    finding: 'No @seam/@layer tags were found; the tests-by-seam grid falls back to directory heuristics (marked ~).',
    evidence: ['docs/reference/tests.json taggingAdopted: false'],
    options: ['adopt @seam/@layer tags', 'accept directory heuristics'], default: 'accept directory heuristics', changes: ['docs/reference/tests.md'],
  }),
  secretLike: names => gap({
    id: 'env-secret-like-names', class: 'project', title: 'Secret-shaped environment variables found',
    finding: `${names.length} env var name(s) look like secrets: ${names.join(', ')}.`, evidence: ['docs/reference/env.json secretLike'],
    options: ['document in secrets.md and add a leak guard'], default: 'document in secrets.md and add a leak guard', changes: ['docs/architecture/secrets.md'],
  }),
  requiredChecksUnknown: () => gap({
    id: 'delivery-required-checks-unknown', class: 'kit', title: 'Delivery extractor could not read required checks',
    finding: 'delivery.requiredChecks is null; the extractor has no GitHub token and makes no network call, so it cannot read branch-protection required checks.',
    evidence: ['docs/reference/delivery.json requiredChecks: null'], options: ['set delivery.requiredChecks in docs/architecture/answers.json'],
    default: 'set delivery.requiredChecks in docs/architecture/answers.json', changes: ['_run/kit-issues.md'],
  }),
};

export function buildGaps(inputs = {}) {
  const { classify, components, drift, deps, delivery, api, tests, env, completeness } = inputs;
  const gaps = [];
  if (classify?.ambiguous) gaps.push(GAPS.kindAmbiguous(classify));
  const cyc = components?.cycles ?? [];
  if (cyc.length === 1) gaps.push(GAPS.importCycle(cyc[0]));
  else if (cyc.length > 1) gaps.push(gap({
    id: 'import-cycles', class: 'human', title: `${cyc.length} import cycles between components`,
    finding: `Two-way imports: ${cyc.map(c => `${c.a}⇄${c.b} (${c.ab}/${c.ba})`).join(', ')}.`,
    evidence: ['docs/reference/components.json cycles', 'docs/reference/components.md'],
    options: ['accept all by ADR and add them to the allow-graph', 'accept the heaviest, split the rest', 'split all'], default: 'accept all by ADR', changes: ['docs/decisions/', 'arch rules (no-cycle rule after the ruling)'],
  }));
  for (const e of drift?.edges?.inHandNotCode ?? []) gaps.push(GAPS.drift(e));
  for (const name of unusedDepEntries(deps)) gaps.push(GAPS.depsUnused(name));
  const missingWhy = missingWhyEntries(deps);
  if (missingWhy.length) gaps.push(GAPS.depsMissingWhy(missingWhy));
  if (api?.source === 'literals') gaps.push(GAPS.apiLiterals());
  if (delivery && delivery.requiredChecks === null) gaps.push(GAPS.requiredChecksUnknown());
  if (tests?.taggingAdopted === false) gaps.push(GAPS.taggingNotAdopted());
  if (env?.secretLike?.length) gaps.push(GAPS.secretLike(env.secretLike));
  for (const reg of completeness?.registers ?? []) {
    for (const c of reg.criteria ?? []) if (c.status === 'fail') gaps.push(GAPS.completeness(reg.file, c));
  }
  return gaps;
}

export function interviewMd(gaps, answers = {}) {
  const pending = gaps.filter(g => g.class === 'human' && !(g.id in answers));
  const lines = ['# Interview', ''];
  pending.forEach((g, i) => lines.push(
    `### Q${i + 1} · ${g.title}   id: ${g.id}`,
    `Finding. ${g.finding}`,
    `Evidence. ${g.evidence.join(', ') || 'none'}`,
    `Options. ${optionsLine(g.options)}`,
    `Default. ${g.default}`,
    `Changes. ${g.changes.join(', ') || 'none'}`,
    '',
  ));
  return `${lines.join('\n').trimEnd()}\n`;
}

function classListMd(title, gaps, cls, extraLines) {
  const lines = [`# ${title}`, ''];
  for (const g of gaps.filter(x => x.class === cls)) {
    lines.push(`## ${g.title}   id: ${g.id}`, g.finding, ...extraLines(g), '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function kitIssuesMd(gaps) {
  return classListMd('Kit issues', gaps, 'kit', g => [`repro: ${g.evidence.join(', ') || 'none'}`]);
}

/**
 * Persist project-class gaps across runs so a fixed defect that comes back is visible as a
 * regression, not silently re-reported as brand new. prev: the previous run's
 * `_run/project-changes.json`, [{id, status, firstSeen, lastSeen}]. gaps: this run's buildGaps()
 * output (only class 'project' entries matter). now: injectable for deterministic tests.
 *
 * Status lifecycle: new (first ever seen) -> open (still present on a later run) -> resolved (no
 * longer in gaps) -> regressed (resolved, then seen again) -> open (still present the run after
 * that). Resolved records are kept — not dropped — so a later reappearance can be told apart from
 * a genuinely new gap.
 */
export function reconcileProjectChanges(prev = [], gaps = [], now = new Date().toISOString().slice(0, 10)) {
  const current = gaps.filter(g => g.class === 'project');
  const currentIds = new Set(current.map(g => g.id));
  const prevMap = new Map(prev.map(p => [p.id, p]));
  const out = [];
  for (const g of current) {
    const p = prevMap.get(g.id);
    if (!p) out.push({ id: g.id, status: 'new', firstSeen: now, lastSeen: now });
    else out.push({ id: g.id, status: p.status === 'resolved' ? 'regressed' : 'open', firstSeen: p.firstSeen ?? now, lastSeen: now });
  }
  for (const p of prev) {
    if (currentIds.has(p.id)) continue;
    out.push(p.status === 'resolved' ? p : { id: p.id, status: 'resolved', firstSeen: p.firstSeen ?? p.lastSeen ?? now, lastSeen: p.lastSeen ?? now });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** changes: optional reconcileProjectChanges() output, joined in by id to render a status line per gap. */
export function projectChangesMd(gaps, changes = []) {
  const byId = new Map(changes.map(c => [c.id, c]));
  return classListMd('Project changes', gaps, 'project', g => {
    const lines = [
      `evidence: ${g.evidence.join(', ') || 'none'}`,
      `changes: ${g.changes.join(', ') || 'none'}`,
    ];
    const c = byId.get(g.id);
    if (c) lines.push(`status: ${c.status} (first seen: ${c.firstSeen}, last seen: ${c.lastSeen})`);
    return lines;
  });
}

export function loadAnswers(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}
