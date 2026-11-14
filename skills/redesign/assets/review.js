// The review page's client. It builds tabs, answer controls and comment boxes from the page's markup (the contract
// is in scripts/render.mjs), saves every change to the review server and to this browser, and marks the review
// finished. A classic script with no dependencies and no build step: the state logic below between the shared
// markers is copied from scripts/review-state.mjs, where it is tested, and a test fails if the two drift apart.
(() => {
  "use strict";

// <shared>
const SETTLED_VALUE = "settled";
const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const entries = (v) => Object.fromEntries(Object.entries(plain(v)).filter(([, e]) => e && typeof e === "object"));
const wrote = (text) => Boolean(String(text ?? "").trim());

const initialState = () => ({ asks: {}, items: {}, comments: {}, extra: "", submitted: false, submittedAt: null });

/** A saved file or browser copy as a state: anything unexpected is dropped, never trusted. */
const shapeState = (raw) => {
  const r = plain(raw);
  return {
    asks: entries(r.asks), items: entries(r.items),
    comments: Object.fromEntries(Object.entries(plain(r.comments)).filter(([, c]) => typeof c === "string")),
    extra: typeof r.extra === "string" ? r.extra : "",
    submitted: Boolean(r.submitted), submittedAt: r.submittedAt ?? null,
  };
};

// A person's own edit clears the bulk mark that "accept the rest" leaves.
const patchAsk = (state, id, patch) => {
  const { bulk, ...kept } = state.asks[id] ?? {};
  return { ...state, asks: { ...state.asks, [id]: { ...kept, ...patch } } };
};
const patchItem = (state, id, patch) => ({ ...state, items: { ...state.items, [id]: { ...(state.items[id] ?? {}), ...patch } } });
const setComment = (state, id, value) => ({ ...state, comments: { ...state.comments, [id]: value } });
const setExtra = (state, value) => ({ ...state, extra: value });

const isAnswered = (a) => {
  const v = a?.value;
  return (Array.isArray(v) ? v.length > 0 : Boolean(v)) || Boolean(a?.accepted) || wrote(a?.note);
};
const isMarked = (i) => Boolean(i?.value) || wrote(i?.note);

/** Settled asks (decided before) are recorded as answered, whatever the reader does. */
const settle = (state, ids) => ids.reduce((s, id) => (s.asks[id]?.value === SETTLED_VALUE ? s : patchAsk(s, id, { value: SETTLED_VALUE })), state);

/** "Accept the rest": each unanswered ask takes its recommendation, or its draft. asks: [{ id, recommended, hasProposal, settled }]. */
const acceptRest = (state, asks) => asks
  .filter((a) => a.settled == null && !isAnswered(state.asks[a.id]))
  .reduce((s, a) => {
    const fill = a.recommended.length ? { value: a.kind === "multi" ? a.recommended : a.recommended[0] } : a.hasProposal ? { accepted: true } : null;
    return fill ? { ...s, asks: { ...s.asks, [a.id]: { ...(s.asks[a.id] ?? {}), ...fill, bulk: true } } } : s;
  }, state);

const decisionOf = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : v);

/** What each id means, so feedback.json reads on its own. extracted comes from the markup: { asks: [...], items: [...] }. */
const buildReference = ({ asks, items }) => ({
  asks: Object.fromEntries(asks.map((a) => [a.id, {
    question: a.question, kind: a.kind || "text",
    options: a.options.map((o) => ({ value: o.value, label: o.label, ...(o.detail ? { detail: o.detail } : {}) })),
    recommended: a.options.filter((o) => o.rec).map((o) => o.value),
    settled: decisionOf(a.settled), optional: Boolean(a.optional),
    ...(a.proposal ? { proposal: a.proposal } : {}),
  }])),
  items: Object.fromEntries(items.map((i) => [i.id, { name: i.name, default: i.default || null }])),
});

const buildPayload = ({ round, title, state, reference }) => ({
  round, title, submitted: state.submitted, submittedAt: state.submittedAt,
  asks: state.asks, items: state.items, comments: state.comments, extra: state.extra, reference,
});

/** The later of the server's copy and this browser's copy, as a state: { source, savedAt, state } or null. */
const newest = (remote, local) => {
  const pick = [["remote", remote], ["local", local]].filter(([, s]) => s && s.savedAt).sort((a, b) => (a[1].savedAt < b[1].savedAt ? 1 : -1))[0];
  return pick ? { source: pick[0], savedAt: pick[1].savedAt, state: shapeState(pick[1]) } : null;
};

const progress = (state, reference) => {
  const required = Object.keys(reference.asks).filter((id) => !reference.asks[id].optional);
  const open = required.filter((id) => !isAnswered(state.asks[id])).length;
  return {
    required: required.length, answered: required.length - open, open,
    marked: Object.keys(reference.items).filter((id) => isMarked(state.items[id])).length,
    comments: Object.values(state.comments).filter(wrote).length,
  };
};

/** The answers as plain text, for the Copy feedback button when the server cannot be reached. */
const readableFeedback = ({ round, title, state, reference }) => {
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

  const round = document.body.dataset.round;
  const api = `/api/feedback/${round}`;
  const storeKey = `review:${round}`;
  const SAVE_AFTER_MS = 500;
  const RETRY_AFTER_MS = 5000;
  const COPY_RESET_MS = 2500;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
  };
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : "");

  // ---- what the markup says, read once before any control is added -------------------------------
  const extractAsk = (ask) => ({
    id: ask.dataset.id,
    question: text($("h3", ask)),
    kind: ask.dataset.kind || "text",
    optional: ask.dataset.optional !== undefined,
    settled: ask.dataset.settled ?? null,
    proposal: text($(".rv-proposal", ask)),
    options: $$(".rv-options li", ask).map((li) => {
      const detail = $("small", li);
      const label = [...li.childNodes].filter((node) => node !== detail).map((node) => node.textContent).join("").replace(/\s+/g, " ").trim();
      return { value: li.dataset.value, label, detail: text(detail), rec: li.dataset.rec !== undefined };
    }),
  });
  const defaultOf = (item) => item.dataset.default ?? item.closest("[data-default]")?.dataset.default ?? "";
  const extracted = {
    asks: $$(".rv-ask").map(extractAsk),
    items: $$(".rv-item").map((item) => ({ id: item.dataset.id, name: text($(".rv-name", item)) || text(item).slice(0, 160), default: defaultOf(item) })),
  };
  const reference = buildReference(extracted);
  const askMeta = extracted.asks.map((a) => ({
    id: a.id, kind: a.kind, settled: a.settled, hasProposal: Boolean(a.proposal), recommended: a.options.filter((o) => o.rec).map((o) => o.value),
  }));
  const settledIds = extracted.asks.filter((a) => a.settled !== null).map((a) => a.id);

  let state = settle(initialState(), settledIds);
  let saveTimer = null;
  let confirmingFinish = false;

  const change = (next) => {
    state = next;
    confirmingFinish = false;
    paint();
    queueSave();
  };

  // ---- saving ------------------------------------------------------------------------------------
  const queueSave = () => {
    try { localStorage.setItem(storeKey, JSON.stringify({ ...state, savedAt: new Date().toISOString() })); }
    catch { /* a private window: the server copy is the one that matters */ }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_AFTER_MS);
    status("saving", "Saving…");
  };
  const save = async () => {
    try {
      const res = await fetch(api, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload({ round, title: document.title, state, reference })),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `the server answered ${res.status}`);
      status("saved", `Saved ${clock(body.savedAt)}`);
    } catch (err) {
      status("unsaved", `Not saved: ${err.message}. Your answers are kept in this browser; retrying. If it stays, use Copy feedback.`);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, RETRY_AFTER_MS);
    }
  };
  const load = async () => {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(storeKey) ?? "null"); } catch { local = null; }
    let remote = null;
    try {
      const res = await fetch(api);
      if (res.ok) remote = await res.json();
    } catch { remote = null; }
    const found = newest(remote, local);
    if (found) {
      state = settle(found.state, settledIds);
      status(remote ? "saved" : "unsaved", remote ? `Saved ${clock(found.savedAt)}` : "Restored from this browser; the review server isn't answering.");
      if (found.source === "local" && remote) queueSave();
    } else {
      status(remote ? "saved" : "unsaved", remote ? "Nothing entered yet" : "The review server isn't answering; answers will be kept in this browser.");
    }
    paint();
  };

  // ---- controls ----------------------------------------------------------------------------------
  const grow = (area) => { area.style.height = "auto"; area.style.height = `${area.scrollHeight + 2}px`; };
  const noteArea = (placeholder, onInput) => {
    const area = el("textarea", { className: "rv-note", rows: 1, placeholder });
    area.addEventListener("input", () => { grow(area); onInput(area.value); });
    return area;
  };

  const buildAsk = (ask) => {
    const id = ask.dataset.id;
    const kind = ask.dataset.kind || "text";
    ask.prepend(el("span", { className: "rv-id", textContent: id }));
    for (const li of $$(".rv-options li", ask)) {
      const input = el("input", { type: kind === "multi" ? "checkbox" : "radio", name: id, value: li.dataset.value });
      input.addEventListener("change", () => {
        const picked = $$("input:checked", $(".rv-options", ask)).map((i) => i.value);
        change(patchAsk(state, id, { value: kind === "multi" ? picked : picked[0] ?? null }));
      });
      const label = el("label");
      label.append(input, el("span", { className: "rv-opt-label" }, ...li.childNodes));
      if (li.dataset.rec !== undefined) label.append(el("span", { className: "rv-rec", textContent: "recommended" }));
      li.append(label);
    }
    if ($(".rv-proposal", ask)) {
      const box = el("input", { type: "checkbox", className: "rv-accept" });
      box.addEventListener("change", () => change(patchAsk(state, id, { accepted: box.checked })));
      ask.append(el("label", { className: "rv-accept-row" }, box, " Use the draft as written"));
    }
    const placeholder = ask.dataset.settled !== undefined ? "Changed your mind? Say so here"
      : kind === "text" ? ($(".rv-proposal", ask) ? "Or your words: what to change, add or drop" : "Your answer")
      : "Note (optional): why, or what none of the options say";
    ask.append(noteArea(placeholder, (value) => change(patchAsk(state, id, { note: value }))));
  };

  const scaleOf = (node) => (node.dataset.scale || node.closest("[data-scale]")?.dataset.scale || "")
    .split(",").filter(Boolean).map((pair) => { const [value, label] = pair.split(":"); return { value: value.trim(), label: (label ?? value).trim() }; });

  const buildItem = (item) => {
    const id = item.dataset.id;
    const controls = el("div", { className: "rv-controls" });
    const scale = el("div", { className: "rv-scale", role: "group" });
    for (const { value, label } of scaleOf(item)) {
      const button = el("button", { type: "button", textContent: label });
      button.dataset.value = value;
      button.addEventListener("click", () => change(patchItem(state, id, { value: state.items[id]?.value === value ? null : value })));
      scale.append(button);
    }
    const area = noteArea("Note", (value) => change(patchItem(state, id, { note: value })));
    const toggle = el("button", { type: "button", className: "rv-note-toggle", textContent: "note" });
    toggle.addEventListener("click", () => { item.classList.toggle("rv-noting"); if (item.classList.contains("rv-noting")) area.focus(); });
    controls.append(scale, toggle);
    item.append(controls, area);
  };

  const buildSetAll = (group) => {
    const row = el("div", { className: "rv-setall" }, "Set all: ");
    for (const { value, label } of scaleOf(group)) {
      const button = el("button", { type: "button", textContent: label });
      button.addEventListener("click", () => change({
        ...state,
        items: { ...state.items, ...Object.fromEntries($$(".rv-item", group).map((item) => [item.dataset.id, { ...(state.items[item.dataset.id] ?? {}), value }])) },
      }));
      row.append(button);
    }
    group.prepend(row);
  };

  const buildComment = (host) => {
    const id = host.dataset.comment;
    const area = noteArea("Comment on this section", (value) => change(setComment(state, id, value)));
    area.classList.add("rv-comment");
    const toggle = el("button", { type: "button", className: "rv-comment-toggle", textContent: "comment" });
    toggle.addEventListener("click", () => { host.classList.toggle("rv-commenting"); if (host.classList.contains("rv-commenting")) area.focus(); });
    host.append(toggle, area);
  };

  const extraArea = $("textarea[data-extra]");
  if (extraArea) extraArea.addEventListener("input", () => { grow(extraArea); change(setExtra(state, extraArea.value)); });

  // ---- tabs and the bar --------------------------------------------------------------------------
  const tabs = $$("main > section.rv-tab");
  const nav = el("nav", { className: "rv-tabs" });
  const nameOf = (tab) => tab.id.replace(/^tab-/, "");
  const showTab = (name) => {
    const current = tabs.find((tab) => nameOf(tab) === name) ?? tabs[0];
    if (!current) return;
    for (const tab of tabs) tab.hidden = tab !== current;
    for (const link of $$("a", nav)) {
      link.classList.toggle("rv-current", link.dataset.tab === nameOf(current));
      if (link.dataset.tab === nameOf(current)) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
    // Back to the top of the new tab, never further up than the reader already was.
    window.scrollTo(0, Math.min(window.scrollY, $("header.rv-top")?.offsetHeight ?? 0));
  };
  const buildTabs = () => {
    if (!tabs.length) return;
    for (const tab of tabs) {
      const link = el("a", { href: `#${nameOf(tab)}` }, tab.dataset.title || nameOf(tab), el("span", { className: "rv-count" }));
      link.dataset.tab = nameOf(tab);
      nav.append(link);
    }
    $("main").before(nav);
    window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
    showTab(location.hash.slice(1));
  };

  const bar = el("footer", { className: "rv-bar" });
  const statusNode = el("span", { className: "rv-status", role: "status" });
  const countsNode = el("span", { className: "rv-counts" });
  const finishButton = el("button", { type: "button", className: "rv-finish" });
  const status = (kind, message) => { statusNode.dataset.kind = kind; statusNode.textContent = message; };
  const requiredAsks = () => $$(".rv-ask:not([data-optional])");
  const answered = (ask) => isAnswered(state.asks[ask.dataset.id]);

  const buildBar = () => {
    const accept = el("button", { type: "button", className: "rv-quiet", textContent: "Accept the rest as recommended" });
    accept.addEventListener("click", () => change(acceptRest(state, askMeta)));
    const copy = el("button", { type: "button", className: "rv-quiet", textContent: "Copy feedback" });
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(readableFeedback({ round, title: document.title, state, reference })); copy.textContent = "Copied"; }
      catch { copy.textContent = "Copy failed: select the page text instead"; }
      setTimeout(() => { copy.textContent = "Copy feedback"; }, COPY_RESET_MS);
    });
    finishButton.addEventListener("click", () => {
      if (state.submitted) return change({ ...state, submitted: false, submittedAt: null });
      const open = progress(state, reference).open;
      if (open > 0 && !confirmingFinish) { confirmingFinish = true; return paint(); }
      return change({ ...state, submitted: true, submittedAt: new Date().toISOString() });
    });
    bar.append(statusNode, countsNode, accept, copy, finishButton);
    document.body.append(bar);
  };

  // ---- paint: the controls follow the state ------------------------------------------------------
  const paint = () => {
    for (const ask of $$(".rv-ask")) {
      const a = state.asks[ask.dataset.id] ?? {};
      const picked = [].concat(a.value ?? []);
      for (const input of $$(".rv-options input", ask)) input.checked = picked.includes(input.value);
      const accept = $(".rv-accept", ask);
      if (accept) accept.checked = Boolean(a.accepted);
      const note = $(":scope > .rv-note", ask);
      if (note && document.activeElement !== note) { note.value = a.note ?? ""; grow(note); }
      ask.classList.toggle("rv-answered", isAnswered(a));
    }
    for (const item of $$(".rv-item")) {
      const i = state.items[item.dataset.id] ?? {};
      const fallback = defaultOf(item);
      for (const button of $$(".rv-scale button", item)) {
        button.setAttribute("aria-pressed", String(i.value === button.dataset.value));
        button.classList.toggle("rv-default", !i.value && fallback === button.dataset.value);
      }
      const note = $(":scope > .rv-note", item);
      if (note && document.activeElement !== note) { note.value = i.note ?? ""; grow(note); }
      if (String(i.note ?? "").trim()) item.classList.add("rv-noting");
      item.classList.toggle("rv-marked", isMarked(i));
    }
    for (const host of $$("[data-comment]")) {
      const area = $(":scope > .rv-comment", host);
      const value = state.comments[host.dataset.comment] ?? "";
      if (area && document.activeElement !== area) { area.value = value; grow(area); }
      if (value.trim()) host.classList.add("rv-commenting");
    }
    if (extraArea && document.activeElement !== extraArea) { extraArea.value = state.extra; grow(extraArea); }
    for (const link of $$("a", nav)) {
      const tab = tabs.find((t) => nameOf(t) === link.dataset.tab);
      const open = $$(".rv-ask:not([data-optional])", tab).filter((ask) => !answered(ask)).length;
      $(".rv-count", link).textContent = open ? String(open) : "";
    }
    const p = progress(state, reference);
    countsNode.textContent = state.submitted
      ? "Review finished. Now tell Claude you're done."
      : `${p.answered}/${p.required} answered · ${p.marked} rows marked · ${p.comments} comments`;
    document.body.classList.toggle("rv-finished", state.submitted);
    finishButton.textContent = state.submitted
      ? `Finished ${clock(state.submittedAt)} · Reopen`
      : confirmingFinish ? `${p.open} questions unanswered. Finish anyway?` : "Finish review";
  };

  // ---- start -------------------------------------------------------------------------------------
  $$(".rv-ask").forEach(buildAsk);
  $$(".rv-items[data-setall]").forEach(buildSetAll);
  $$(".rv-item").forEach(buildItem);
  $$("[data-comment]").forEach(buildComment);
  buildTabs();
  buildBar();
  load();
})();
