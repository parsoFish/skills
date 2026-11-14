import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import {
  SETTLED_VALUE, acceptRest, buildPayload, buildReference, initialState, isAnswered, isMarked, newest, patchAsk, patchItem,
  progress, readableFeedback, setComment, setExtra, settle, shapeState,
} from "./review-state.mjs";

const here = (name) => new URL(name, import.meta.url);
const SHARED = /\/\/ <shared>\n([\s\S]*?)\/\/ <\/shared>/;
const sharedOf = (file) => SHARED.exec(readFileSync(file, "utf8"))[1];

test("review.js carries exactly the functions tested here (it is a classic script and imports nothing)", () => {
  const source = sharedOf(here("review-state.mjs")).replace(/^export /gm, "");
  assert.equal(sharedOf(here("../assets/review.js")), source);
  const client = readFileSync(here("../assets/review.js"), "utf8");
  assert.doesNotMatch(client, /^\s*(import |export )/m);
  assert.doesNotMatch(client, /require\(/);
  assert.doesNotThrow(() => new Script(client, { filename: "review.js" }));
});

test("the shared block is pure: no document, window or network", () => {
  assert.doesNotMatch(sharedOf(here("review-state.mjs")), /\b(document|window|localStorage|fetch|navigator)\b/);
});

test("shapeState tolerates anything a saved file or old browser copy might hold", () => {
  assert.deepEqual(shapeState(null), initialState());
  assert.deepEqual(shapeState({ asks: "x", items: [], comments: 4, extra: 9 }), initialState());
  const kept = shapeState({ asks: { a: { value: "x" }, b: 5 }, items: { i: { value: "k" } }, comments: { c: "hi" }, extra: "more", submitted: 1, submittedAt: "t", ignored: true });
  assert.deepEqual(kept, { asks: { a: { value: "x" } }, items: { i: { value: "k" } }, comments: { c: "hi" }, extra: "more", submitted: true, submittedAt: "t" });
});

test("patches return a new state and leave the old one alone", () => {
  const s0 = Object.freeze(initialState());
  const s1 = patchAsk(s0, "q", { value: "a" });
  const s2 = patchAsk(s1, "q", { note: "n" });
  assert.deepEqual(s2.asks, { q: { value: "a", note: "n" } });
  assert.deepEqual(s0.asks, {});
  assert.deepEqual(patchItem(s0, "r", { value: "keep" }).items, { r: { value: "keep" } });
  assert.deepEqual(setComment(s0, "sec.x", "c").comments, { "sec.x": "c" });
  assert.equal(setExtra(s0, "e").extra, "e");
});

test("a person's own answer clears the bulk mark", () => {
  const bulk = { ...initialState(), asks: { q: { value: "a", bulk: true } } };
  assert.deepEqual(patchAsk(bulk, "q", { value: "b" }).asks.q, { value: "b" });
});

test("answered means a pick, an accepted draft or a note; marked means a value or a note", () => {
  assert.equal(isAnswered(undefined), false);
  assert.equal(isAnswered({ value: [] }), false);
  assert.equal(isAnswered({ value: ["a"] }), true);
  assert.equal(isAnswered({ value: "a" }), true);
  assert.equal(isAnswered({ accepted: true }), true);
  assert.equal(isAnswered({ note: "  " }), false);
  assert.equal(isAnswered({ note: "why" }), true);
  assert.equal(isMarked({ value: "keep" }), true);
  assert.equal(isMarked({ note: " " }), false);
  assert.equal(isMarked(undefined), false);
});

test("settle records a settled ask as answered and keeps any note", () => {
  const s = settle({ ...initialState(), asks: { b: { note: "hm" } } }, ["a", "b"]);
  assert.deepEqual(s.asks, { a: { value: SETTLED_VALUE }, b: { note: "hm", value: SETTLED_VALUE } });
  assert.equal(isAnswered(s.asks.a), true);
});

const ASKS = [
  { id: "q1", kind: "choice", recommended: ["a"], hasProposal: false, settled: null },
  { id: "q2", kind: "multi", recommended: ["x", "y"], hasProposal: false, settled: null },
  { id: "q3", kind: "text", recommended: [], hasProposal: true, settled: null },
  { id: "q4", kind: "text", recommended: [], hasProposal: false, settled: null },
  { id: "q5", kind: "choice", recommended: ["a"], hasProposal: false, settled: 7 },
  { id: "q6", kind: "choice", recommended: ["a"], hasProposal: false, settled: null },
];

test("acceptRest fills only the unanswered asks, from the recommendation or the draft, marked as bulk", () => {
  const s = acceptRest({ ...initialState(), asks: { q6: { value: "b" } } }, ASKS);
  assert.deepEqual(s.asks.q1, { value: "a", bulk: true });
  assert.deepEqual(s.asks.q2, { value: ["x", "y"], bulk: true });
  assert.deepEqual(s.asks.q3, { accepted: true, bulk: true });
  assert.equal(s.asks.q4, undefined);
  assert.equal(s.asks.q5, undefined);
  assert.deepEqual(s.asks.q6, { value: "b" });
});

const EXTRACTED = {
  asks: [
    { id: "q1", question: "Core first?", kind: "choice", optional: false, settled: null, proposal: "",
      options: [{ value: "a", label: "Core", detail: "sessions", rec: true }, { value: "b", label: "All", detail: "", rec: false }] },
    { id: "q2", question: "Why?", kind: "text", optional: true, settled: "12", proposal: "It grew.", options: [] },
  ],
  items: [{ id: "r1", name: "Home", default: "keep" }, { id: "r2", name: "Search", default: "" }],
};

test("buildReference makes the file readable without its page", () => {
  assert.deepEqual(buildReference(EXTRACTED), {
    asks: {
      q1: { question: "Core first?", kind: "choice", options: [{ value: "a", label: "Core", detail: "sessions" }, { value: "b", label: "All" }], recommended: ["a"], settled: null, optional: false },
      q2: { question: "Why?", kind: "text", options: [], recommended: [], settled: 12, optional: true, proposal: "It grew." },
    },
    items: { r1: { name: "Home", default: "keep" }, r2: { name: "Search", default: null } },
  });
});

test("buildPayload is what the server saves; the server stamps savedAt", () => {
  const state = { ...initialState(), extra: "e", submitted: true, submittedAt: "2026-11-14T10:00:00Z" };
  const ref = buildReference(EXTRACTED);
  assert.deepEqual(buildPayload({ round: "01-prd-1", title: "T", state, reference: ref }),
    { round: "01-prd-1", title: "T", submitted: true, submittedAt: "2026-11-14T10:00:00Z", asks: {}, items: {}, comments: {}, extra: "e", reference: ref });
});

test("newest prefers the later copy, and says which it was", () => {
  const remote = { savedAt: "2026-11-14T10:00:00Z", extra: "remote" };
  const local = { savedAt: "2026-11-14T11:00:00Z", extra: "local" };
  assert.equal(newest(remote, local).source, "local");
  assert.equal(newest(remote, local).state.extra, "local");
  assert.equal(newest(local, remote).source, "remote");
  assert.equal(newest(null, remote).source, "local");
  assert.equal(newest(remote, null).source, "remote");
  assert.equal(newest({ extra: "no stamp" }, null), null);
  assert.equal(newest(null, null), null);
});

test("progress counts required asks answered, rows marked and comments written", () => {
  const ref = buildReference(EXTRACTED);
  const state = { ...initialState(), asks: { q1: { value: "a" } }, items: { r1: { value: "drop" }, r2: { note: " " } }, comments: { a: "x", b: " ", c: "y" } };
  assert.deepEqual(progress(state, ref), { required: 1, answered: 1, open: 0, marked: 1, comments: 2 });
  assert.deepEqual(progress(initialState(), ref), { required: 1, answered: 0, open: 1, marked: 0, comments: 0 });
});

test("readableFeedback names each ask by its question and each answer by its label", () => {
  const ref = buildReference(EXTRACTED);
  const state = {
    ...initialState(), extra: "Thanks",
    asks: { q1: { value: "a", note: "because", bulk: true }, q2: { value: SETTLED_VALUE } },
    items: { r1: { value: "drop", note: "gone" }, r2: {} },
    comments: { "sec.x": "fix this", "sec.y": " " },
  };
  assert.equal(readableFeedback({ round: "01-prd-1", title: "Framing", state, reference: ref }), [
    "Review 01-prd-1: Framing", "",
    "[q1] Core first?", "  -> Core | (accepted in bulk) | note: because",
    "[q2] Why?", "  -> settled in decision 12",
    "[r1] Home", "  -> drop | note: gone",
    "[comment sec.x] fix this",
    "[extra] Thanks",
  ].join("\n"));
});

test("readableFeedback keeps an unknown option value rather than losing it", () => {
  const ref = buildReference(EXTRACTED);
  const out = readableFeedback({ round: "r", title: "t", state: { ...initialState(), asks: { q1: { value: ["a", "zzz"] } } }, reference: ref });
  assert.match(out, /-> Core; zzz/);
});

test("review.css loads nothing from outside and every class in it is rv-prefixed", () => {
  const css = readFileSync(here("../assets/review.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /@import|url\(|https?:|\/\/[a-z]/i);
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]);
  const classes = selectors.flatMap((s) => [...s.matchAll(/\.([a-z][\w-]*)/gi)].map((m) => m[1]));
  assert.ok(classes.length > 40);
  assert.deepEqual([...new Set(classes.filter((c) => !c.startsWith("rv-")))], []);
});

test("review.js reads the markup classes render.mjs writes, all rv-prefixed", () => {
  const client = readFileSync(here("../assets/review.js"), "utf8");
  const used = [...client.matchAll(/["'`.]\.?(rv-[a-z-]+)/g)].map((m) => m[1]);
  assert.ok(new Set(used).size > 25);
  assert.doesNotMatch(client, /className: "(?!rv-)/);
});
