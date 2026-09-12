// Fold a dependency-cruiser JSON module graph into components by rules.
// Deterministic: sorted output, no timestamps. Pure functions + CLI.
import { readFileSync } from 'node:fs';

/** rules: [{ match: RegExp|string, component: string }], first match wins; "$1" expands captures */
export function compile(rules) {
  return rules.map(r => ({ re: r.match instanceof RegExp ? r.match : new RegExp(r.match), component: r.component }));
}

export function componentOf(path, rules) {
  for (const r of rules) {
    const m = path.match(r.re);
    if (m) return r.component.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '');
  }
  return null;
}

export const DEFAULT_TEST_PATTERN = /(^|\/)(tests?|__tests__|test-fixtures|stories|fixtures)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/;

export function fold(depcruise, rules, { excludeTests = true, testPattern = DEFAULT_TEST_PATTERN } = {}) {
  const compiled = compile(rules);
  const isTest = p => excludeTests && testPattern.test(p);
  const files = new Map(); const tests = new Map(); const edges = new Map();
  for (const mod of depcruise.modules ?? []) {
    const c = componentOf(mod.source, compiled);
    if (!c) continue;
    if (isTest(mod.source)) { tests.set(c, (tests.get(c) ?? 0) + 1); continue; }
    files.set(c, (files.get(c) ?? 0) + 1);
    for (const dep of mod.dependencies ?? []) {
      const target = dep.resolved ?? dep.module ?? '';
      const t = componentOf(target, compiled);
      if (!t || t === c || isTest(target)) continue;
      const k = `${c} ${t}`; edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  const nodes = [...files.keys()].sort().map(id => ({ id, files: files.get(id), tests: tests.get(id) ?? 0 }));
  const edgeList = [...edges.entries()].map(([k, count]) => { const [from, to] = k.split(' '); return { from, to, count }; })
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { nodes, edges: edgeList };
}

export function cycles(graph) {
  const set = new Map(graph.edges.map(e => [`${e.from} ${e.to}`, e.count]));
  const out = [];
  for (const e of graph.edges) {
    const back = set.get(`${e.to} ${e.from}`);
    if (back !== undefined && e.from < e.to) out.push({ a: e.from, b: e.to, ab: e.count, ba: back });
  }
  return out.sort((x, y) => (y.ab + y.ba) - (x.ab + x.ba) || x.a.localeCompare(y.a));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, rulesPath] = process.argv.slice(2);
  const dc = JSON.parse(readFileSync(input, 'utf8'));
  const rules = JSON.parse(readFileSync(rulesPath, 'utf8')).rules;
  const g = fold(dc, rules);
  process.stdout.write(JSON.stringify({ ...g, cycles: cycles(g) }, null, 1) + '\n');
}
