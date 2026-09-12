// Compare a hand model's declared relationships with a code-derived graph. Engine-agnostic set diff.
// hand: { nodes?: [{id}], edges: [{from,to,runtime?:boolean}] }   code: { nodes: [{id}], edges: [{from,to,count}] }
export function tokens(s) { return new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)); }
export function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  const i = [...A].filter(x => B.has(x)).length; const u = new Set([...A, ...B]).size;
  return u ? i / u : 0;
}

export function drift(hand, code, { renameThreshold = 0.6, internal = null } = {}) {
  const scope = internal ? id => internal.has(id) : () => true;
  const handEdges = hand.edges.filter(e => !e.runtime && scope(e.from) && scope(e.to));
  const codeMap = new Map(code.edges.filter(e => scope(e.from) && scope(e.to)).map(e => [`${e.from} ${e.to}`, e.count]));
  const handSet = new Set(handEdges.map(e => `${e.from} ${e.to}`));
  const inHandNotCode = handEdges.filter(e => !codeMap.has(`${e.from} ${e.to}`)).map(e => ({ from: e.from, to: e.to }));
  const inCodeNotHand = [...codeMap.entries()].filter(([k]) => !handSet.has(k))
    .map(([k, count]) => { const [from, to] = k.split(' '); return { from, to, count }; })
    .sort((x, y) => y.count - x.count || x.from.localeCompare(y.from));
  const handNodes = new Set((hand.nodes ?? []).map(n => n.id)); const codeNodes = new Set((code.nodes ?? []).map(n => n.id));
  const removed = [...handNodes].filter(n => !codeNodes.has(n)); const added = [...codeNodes].filter(n => !handNodes.has(n));
  const renamed = [];
  for (const r of removed) for (const a of added) { const s = jaccard(r, a); if (s >= renameThreshold) renamed.push({ from: r, to: a, score: s }); }
  const skippedRuntime = hand.edges.filter(e => e.runtime).length;
  return {
    nodes: { added: added.filter(a => !renamed.some(x => x.to === a)).sort(), removed: removed.filter(r => !renamed.some(x => x.from === r)).sort(), renamed },
    edges: { inHandNotCode, inCodeNotHand, skippedRuntime },
    unexplained: inHandNotCode.length,
  };
}
