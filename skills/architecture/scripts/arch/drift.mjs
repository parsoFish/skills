// Compare a hand model's declared relationships with a code-derived graph. Engine-agnostic set diff.
// hand: { nodes?: [{id}], edges: [{from,to,runtime?:boolean}] }   code: { nodes: [{id}], edges: [{from,to,count}] }
//
// The loop must not fail open: every code edge the hand model never declared counts as
// unexplained, not only the reverse. A shrink-only `baseline` ({ edges: ["a b", …] }) lets a
// project accept a known batch of undeclared edges as debt — written once via
// writeBaselineProposal, trimmed only via shrinkBaseline (never grown implicitly here). Any code
// edge outside the baseline is `undeclared` and always counts toward `unexplained`.
export function tokens(s) { return new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)); }
export function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  const i = [...A].filter(x => B.has(x)).length; const u = new Set([...A, ...B]).size;
  return u ? i / u : 0;
}

const edgeKey = e => `${e.from} ${e.to}`;

export function drift(hand, code, { renameThreshold = 0.6, internal = null, baseline = { edges: [] } } = {}) {
  const scope = internal ? id => internal.has(id) : () => true;
  const handEdges = hand.edges.filter(e => !e.runtime && scope(e.from) && scope(e.to));
  const codeEdges = code.edges.filter(e => scope(e.from) && scope(e.to));
  const codeMap = new Map(codeEdges.map(e => [edgeKey(e), e.count]));
  const handSet = new Set(handEdges.map(edgeKey));
  const inHandNotCode = handEdges.filter(e => !codeMap.has(edgeKey(e))).map(e => ({ from: e.from, to: e.to }));
  const inCodeNotHand = [...codeMap.entries()].filter(([k]) => !handSet.has(k))
    .map(([k, count]) => { const [from, to] = k.split(' '); return { from, to, count }; })
    .sort((x, y) => y.count - x.count || x.from.localeCompare(y.from));
  const baselineSet = new Set(baseline?.edges ?? []);
  const undeclared = inCodeNotHand.filter(e => !baselineSet.has(edgeKey(e)));
  const baselineStale = [...baselineSet].filter(k => !codeMap.has(k)).sort();
  const handNodes = new Set((hand.nodes ?? []).map(n => n.id)); const codeNodes = new Set((code.nodes ?? []).map(n => n.id));
  const removed = [...handNodes].filter(n => !codeNodes.has(n)); const added = [...codeNodes].filter(n => !handNodes.has(n));
  const renamed = [];
  for (const r of removed) for (const a of added) { const s = jaccard(r, a); if (s >= renameThreshold) renamed.push({ from: r, to: a, score: s }); }
  const skippedRuntime = hand.edges.filter(e => e.runtime).length;
  return {
    nodes: { added: added.filter(a => !renamed.some(x => x.to === a)).sort(), removed: removed.filter(r => !renamed.some(x => x.from === r)).sort(), renamed },
    edges: { inHandNotCode, inCodeNotHand, skippedRuntime, undeclared, baselineStale },
    unexplained: inHandNotCode.length + undeclared.length,
  };
}

/** A first run's proposal: every currently-undeclared code edge, as a baseline a project can save and commit. */
export function writeBaselineProposal(result) {
  return { edges: result.edges.inCodeNotHand.map(edgeKey).sort() };
}

/** Shrink-only: drop baseline entries the code no longer shows (result.edges.baselineStale). Never adds. */
export function shrinkBaseline(baseline, result) {
  const stale = new Set(result.edges.baselineStale ?? []);
  return { edges: (baseline?.edges ?? []).filter(k => !stale.has(k)).sort() };
}
