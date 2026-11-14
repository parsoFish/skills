// The review page's state logic, free of the DOM so it can be tested. assets/review.js is a classic script that
// imports nothing, so the block between the <shared> markers is copied into it verbatim (a test fails if they differ).
// Shapes match feedback.json: asks { value, note, accepted }, items { value, note }, comments, extra, reference.

// <shared>
export const SETTLED_VALUE = "settled";
const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const entries = (v) => Object.fromEntries(Object.entries(plain(v)).filter(([, e]) => e && typeof e === "object"));
const wrote = (text) => Boolean(String(text ?? "").trim());

export const initialState = () => ({ asks: {}, items: {}, comments: {}, extra: "", submitted: false, submittedAt: null });

/** A saved file or browser copy as a state: anything unexpected is dropped, never trusted. */
export const shapeState = (raw) => {
  const r = plain(raw);
  return {
    asks: entries(r.asks), items: entries(r.items),
    comments: Object.fromEntries(Object.entries(plain(r.comments)).filter(([, c]) => typeof c === "string")),
    extra: typeof r.extra === "string" ? r.extra : "",
    submitted: Boolean(r.submitted), submittedAt: r.submittedAt ?? null,
  };
};

// A person's own edit clears the bulk mark that "accept the rest" leaves.
export const patchAsk = (state, id, patch) => {
  const { bulk, ...kept } = state.asks[id] ?? {};
  return { ...state, asks: { ...state.asks, [id]: { ...kept, ...patch } } };
};
export const patchItem = (state, id, patch) => ({ ...state, items: { ...state.items, [id]: { ...(state.items[id] ?? {}), ...patch } } });
export const setComment = (state, id, value) => ({ ...state, comments: { ...state.comments, [id]: value } });
export const setExtra = (state, value) => ({ ...state, extra: value });

export const isAnswered = (a) => {
  const v = a?.value;
  return (Array.isArray(v) ? v.length > 0 : Boolean(v)) || Boolean(a?.accepted) || wrote(a?.note);
};
export const isMarked = (i) => Boolean(i?.value) || wrote(i?.note);

/** Settled asks (decided before) are recorded as answered, whatever the reader does. */
export const settle = (state, ids) => ids.reduce((s, id) => (s.asks[id]?.value === SETTLED_VALUE ? s : patchAsk(s, id, { value: SETTLED_VALUE })), state);

/** "Accept the rest": each unanswered ask takes its recommendation, or its draft. asks: [{ id, recommended, hasProposal, settled }]. */
export const acceptRest = (state, asks) => asks
  .filter((a) => a.settled == null && !isAnswered(state.asks[a.id]))
  .reduce((s, a) => {
    const fill = a.recommended.length ? { value: a.kind === "multi" ? a.recommended : a.recommended[0] } : a.hasProposal ? { accepted: true } : null;
    return fill ? { ...s, asks: { ...s.asks, [a.id]: { ...(s.asks[a.id] ?? {}), ...fill, bulk: true } } } : s;
  }, state);

const decisionOf = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : v);

/** What each id means, so feedback.json reads on its own. extracted comes from the markup: { asks: [...], items: [...] }. */
export const buildReference = ({ asks, items }) => ({
  asks: Object.fromEntries(asks.map((a) => [a.id, {
    question: a.question, kind: a.kind || "text",
    options: a.options.map((o) => ({ value: o.value, label: o.label, ...(o.detail ? { detail: o.detail } : {}) })),
    recommended: a.options.filter((o) => o.rec).map((o) => o.value),
    settled: decisionOf(a.settled), optional: Boolean(a.optional),
    ...(a.proposal ? { proposal: a.proposal } : {}),
  }])),
  items: Object.fromEntries(items.map((i) => [i.id, { name: i.name, default: i.default || null }])),
});

export const buildPayload = ({ round, title, state, reference }) => ({
  round, title, submitted: state.submitted, submittedAt: state.submittedAt,
  asks: state.asks, items: state.items, comments: state.comments, extra: state.extra, reference,
});

/** The later of the server's copy and this browser's copy, as a state: { source, savedAt, state } or null. */
export const newest = (remote, local) => {
  const pick = [["remote", remote], ["local", local]].filter(([, s]) => s && s.savedAt).sort((a, b) => (a[1].savedAt < b[1].savedAt ? 1 : -1))[0];
  return pick ? { source: pick[0], savedAt: pick[1].savedAt, state: shapeState(pick[1]) } : null;
};

export const progress = (state, reference) => {
  const required = Object.keys(reference.asks).filter((id) => !reference.asks[id].optional);
  const open = required.filter((id) => !isAnswered(state.asks[id])).length;
  return {
    required: required.length, answered: required.length - open, open,
    marked: Object.keys(reference.items).filter((id) => isMarked(state.items[id])).length,
    comments: Object.values(state.comments).filter(wrote).length,
  };
};

/** The answers as plain text, for the Copy feedback button when the server cannot be reached. */
export const readableFeedback = ({ round, title, state, reference }) => {
  const lines = [`Review ${round}: ${title}`, ""];
  for (const [id, a] of Object.entries(state.asks)) {
    const r = reference.asks[id];
    if (!r) continue;
    const label = (v) => r.options.find((o) => o.value === v)?.label ?? v;
    const picked = a.value === SETTLED_VALUE ? `settled in decision ${r.settled ?? "?"}` : [].concat(a.value ?? []).map(label).join("; ");
    const parts = [picked, a.accepted ? "draft accepted" : "", a.bulk ? "(accepted in bulk)" : "", wrote(a.note) ? `note: ${a.note}` : ""].filter(Boolean);
    if (parts.length) lines.push(`[${id}] ${r.question}`, `  -> ${parts.join(" | ")}`);
  }
  for (const [id, i] of Object.entries(state.items)) {
    if (!isMarked(i)) continue;
    lines.push(`[${id}] ${reference.items[id]?.name ?? ""}`, `  -> ${[i.value, wrote(i.note) ? `note: ${i.note}` : ""].filter(Boolean).join(" | ")}`);
  }
  for (const [id, c] of Object.entries(state.comments)) if (wrote(c)) lines.push(`[comment ${id}] ${c}`);
  if (wrote(state.extra)) lines.push(`[extra] ${state.extra}`);
  return lines.join("\n");
};
// </shared>
