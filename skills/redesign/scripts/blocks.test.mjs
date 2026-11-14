import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEP_REWORK_MERGE_DROP, docTab, folded, lockPage, md, parseDecisions, sections, sinceTab, teardown, toYou } from "./blocks.mjs";
import { counts, page } from "./render.mjs";

test("md and sections are the markdown module's, re-exported for build scripts", () => {
  assert.equal(md("**x**"), "<p><b>x</b></p>");
  assert.equal(sections("## A\n\nb")[0].slug, "a");
});

test("docTab gives each ## section one block with its own comment box", () => {
  const html = docTab({ id: "prd", title: "The PRD", markdown: "Draft 2.\n\n# Doc\n\nIntro text\n\n## Scope\n\n- one\n- two\n\n### Detail\n\nmore\n\n## Open questions\n\nnone" });
  assert.match(html, /^<h2>The PRD<\/h2>/);
  assert.match(html, /<div class="rv-block" data-comment="sec\.prd\.scope"><h3>Scope<\/h3>\n<ul><li>one<\/li><li>two<\/li><\/ul>\n<h4>Detail<\/h4>/);
  assert.match(html, /<div class="rv-block" data-comment="sec\.prd\.open-questions"><h3>Open questions<\/h3>/);
  assert.match(html, /<p>Draft 2\.<\/p>/);
  assert.match(html, /<p>Intro text<\/p>/);
  assert.equal((html.match(/data-comment=/g) ?? []).length, 2);
});

test("docTab leaves the comment boxes off when asked, and fits into a page", () => {
  const html = docTab({ id: "arch", title: "Architecture", markdown: "## One\n\nx", comments: false });
  assert.doesNotMatch(html, /data-comment/);
  assert.match(html, /<div class="rv-block"><h3>One<\/h3>/);
  const doc = page({ round: "02-arch-1", title: "t", tabs: [{ id: "arch", title: "Architecture", html: docTab({ id: "arch", title: "A", markdown: "## One\n\nx\n\n## One\n\ny" }) }] });
  assert.match(doc, /sec\.arch\.one"/);
  assert.match(doc, /sec\.arch\.one-2"/);
});

test("docTab refuses a tab id the page cannot address and non-text markdown", () => {
  assert.throws(() => docTab({ id: "has space", title: "t", markdown: "## a" }), /not a usable id/);
  assert.throws(() => docTab({ id: "a", title: "t" }), /markdown must be a string/);
});

test("folded is a details element, closed unless asked", () => {
  assert.equal(folded("Why <this>", "<p>x</p>"), `<details class="rv-folded"><summary>Why &lt;this&gt;</summary><p>x</p></details>`);
  assert.equal(folded("t", "x", true), `<details class="rv-folded" open><summary>t</summary>x</details>`);
});

test("teardown makes one row per existing screen, defaulting to the proposed verdict", () => {
  const html = teardown({ rows: [
    { id: "now.system", name: "System page", verdict: "rework", what: "Where it runs & how", goes: "Becomes the Home place." },
    { id: "now.prune", name: "Open counts", verdict: "drop", what: "Counts opens", goes: "Gone." },
  ] });
  assert.match(html, /<div class="rv-items" data-scale="keep:Keep,rework:Rework,merge:Merge,drop:Drop">/);
  assert.match(html, /<div class="rv-item" data-id="now\.system" data-default="rework">/);
  assert.match(html, /<div class="rv-item" data-id="now\.prune" data-default="drop">/);
  assert.match(html, /<div class="rv-desc">Where it runs &amp; how<\/div><div class="rv-desc"><b>Proposed\.<\/b> Becomes the Home place\.<\/div>/);
  assert.deepEqual(KEEP_REWORK_MERGE_DROP.map((s) => s.value), ["keep", "rework", "merge", "drop"]);
});

test("teardown takes its own scale and refuses a verdict that is not on it", () => {
  const scale = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
  assert.match(teardown({ scale, rows: [{ id: "a", name: "A", verdict: "no", what: "w", goes: "g" }] }), /data-default="no"/);
  assert.throws(() => teardown({ rows: [{ id: "a", name: "A", verdict: "maybe", what: "w", goes: "g" }] }), /verdict "maybe" is not on the scale/);
  assert.throws(() => teardown({ rows: [] }), /at least one row/);
});

const DECISIONS = `# Decisions

| # | Date | Kind | Track | Decision | Source |
|---|---|---|---|---|---|
| 11 | 2026-11-10 | product | app | Older choice. | 01-prd-1 r.a |
| 12 | 2026-11-14 | product | app | The router only routes. | 02-map-1 r.scope |
| 13 | 2026-11-14 | process | - | Wireframes before words \\| always (replaces 7) | 02-map-1 r.order |
| 14 | 2026-11-14 | standing | - | Copy fixes are mine to make (scope: wording only) | chat |
| 15 | 2026-11-15 | product | app | Another <thing>. | 02-map-2 r.x |
`;

test("parseDecisions reads the current row format", () => {
  const rows = parseDecisions(DECISIONS);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[1], { n: 12, date: "2026-11-14", kind: "product", track: "app", text: "The router only routes.", source: "02-map-1 r.scope", replaces: null });
  assert.equal(rows[2].text, "Wireframes before words | always (replaces 7)");
  assert.equal(rows[2].replaces, 7);
  assert.equal(rows[3].kind, "standing");
});

test("parseDecisions tolerates the older five-column format", () => {
  const old = "| # | date | stage | decision | source |\n|---|---|---|---|---|\n| 131 | 2026-09-01 | 2 | Insight is agreed. | 01-prd-1 q.x |\n";
  assert.deepEqual(parseDecisions(old), [{ n: 131, date: "2026-09-01", kind: "", track: "", text: "Insight is agreed.", source: "01-prd-1 q.x", replaces: null }]);
  assert.deepEqual(parseDecisions(""), []);
  assert.throws(() => parseDecisions(undefined), /decisionsMd must be a string/);
});

test("sinceTab shows the decisions whose source names one of the rounds", () => {
  const html = sinceTab({ decisionsMd: DECISIONS, rounds: ["02-map-1"] });
  assert.match(html, /<div class="rv-block" data-comment="sec\.since">/);
  assert.match(html, /<h2>Since last time<\/h2>/);
  assert.match(html, /decisions 12 to 13/);
  assert.match(html, /<td>12<\/td><td>The router only routes\.<\/td><td>02-map-1 r\.scope<\/td>/);
  assert.match(html, /<td>13<\/td>/);
  assert.doesNotMatch(html, /Older choice|Another/);
  assert.doesNotMatch(html, /Copy fixes/);
});

test("sinceTab shows a pipe in a decision's text as a pipe, not as the escape round decide wrote", () => {
  const html = sinceTab({ decisionsMd: DECISIONS, rounds: ["02-map-1"] });
  assert.match(html, /<td>Wireframes before words \| always \(replaces 7\)<\/td>/);
  assert.doesNotMatch(html, /\\\|/);
});

test("sinceTab reads several rounds, escapes the text, and takes a title", () => {
  const html = sinceTab({ decisionsMd: DECISIONS, rounds: ["02-map-1", "02-map-2"], title: "What your answers became" });
  assert.match(html, /<h2>What your answers became<\/h2>/);
  assert.match(html, /decisions 12 to 13 and 15/);
  assert.match(html, /Another &lt;thing&gt;\./);
});

test("sinceTab says so when nothing was recorded, and refuses an empty round list", () => {
  assert.match(sinceTab({ decisionsMd: DECISIONS, rounds: ["09-zzz-1"] }), /No decision was recorded from 09-zzz-1\./);
  assert.throws(() => sinceTab({ decisionsMd: DECISIONS, rounds: [] }), /at least one round/);
  assert.match(sinceTab({ decisionsMd: DECISIONS, rounds: ["01-prd-1"] }), /decision 11\b/);
});

const DOCS = [
  { name: "Product requirements", path: "docs/prd.md", changedSince: ["Added **PAY-3**, refunds.", "Dropped the export story."], link: "../../docs/prd.md" },
  { name: "Architecture", path: "docs/arch.md", changedSince: [] },
];

test("lockPage lists what changed, what is unproven and the risks, one row per document, and the lock ask", () => {
  const html = lockPage({ documents: DOCS, unproven: ["The queue under load"], risks: ["One person knows the deploy"] });
  assert.match(html, /<h2>What changed since the last agreed draft<\/h2>/);
  assert.match(html, /<h3>Product requirements<\/h3><ul><li>Added <b>PAY-3<\/b>, refunds\.<\/li><li>Dropped the export story\.<\/li><\/ul>/);
  assert.match(html, /Architecture<\/h3><p>No change since the last agreed draft\.<\/p>/);
  assert.match(html, /<h2>What is still unproven<\/h2><ul><li>The queue under load<\/li><\/ul>/);
  assert.match(html, /<h2>Risks<\/h2><ul><li>One person knows the deploy<\/li><\/ul>/);
  assert.match(html, /data-scale="lock:Lock,not-yet:Not yet" data-default="lock"/);
  assert.match(html, /data-id="doc\.product-requirements"/);
  assert.match(html, /data-id="doc\.architecture"/);
  assert.match(html, /<a href="\.\.\/\.\.\/docs\/prd\.md">/);
  assert.match(html, /<article class="rv-ask" data-id="lock" data-kind="choice">/);
  assert.deepEqual(counts(html), { asks: 1, items: 2, figures: 0 });
});

test("lockPage takes its own ask and says so when nothing is unproven or risky", () => {
  const html = lockPage({ documents: DOCS, ask: { id: "l.stage", kind: "choice", q: "Lock stage 2?", options: [{ value: "lock", label: "Lock it", rec: true }, { value: "wait", label: "Wait" }] } });
  assert.match(html, /data-id="l\.stage"/);
  assert.match(html, /<h2>What is still unproven<\/h2><p>Nothing is listed as unproven\.<\/p>/);
  assert.match(html, /<h2>Risks<\/h2><p>No risks are listed\.<\/p>/);
});

test("lockPage never re-renders a document: a changed line is one short line", () => {
  assert.throws(() => lockPage({ documents: [{ name: "A", path: "a.md", changedSince: ["one\ntwo"] }] }), /one short line/);
  assert.throws(() => lockPage({ documents: [{ name: "A", path: "a.md", changedSince: ["x".repeat(500)] }] }), /one short line/);
  assert.throws(() => lockPage({ documents: [] }), /at least one document/);
  assert.throws(() => lockPage({ documents: [{ name: "A", path: "a.md", changedSince: [], link: "https://x.test/a" }] }), /relative path/);
  assert.throws(() => lockPage({ documents: [{ name: "A", path: "a.md" }, { name: "a", path: "b.md" }] }), /twice/);
});

test("toYou turns the person's third-person phrases into second person", () => {
  const pairs = [["Sam's", "your"], ["Sam can", "You can"], ["him", "you"]];
  assert.equal(toYou("Sam's list. Sam can stop it. Ask him.", pairs), "your list. You can stop it. Ask you.");
});

test("toYou throws when a phrase to replace is still present afterwards, so a page cannot ship naming the person", () => {
  assert.throws(() => toYou("Ask Sam", [["Sam", "Sam Smith"]]), /still names "Sam"/);
  assert.throws(() => toYou("x", [["", "y"]]), /pair needs a phrase to replace/);
  assert.throws(() => toYou("x", [["a"]]), /pair needs a phrase to replace/);
  assert.equal(toYou("untouched text"), "untouched text");
  assert.equal(toYou("untouched text", [["Sam", "you"]]), "untouched text");
});

test("toYou does not change its inputs", () => {
  const pairs = Object.freeze([Object.freeze(["a", "b"])]);
  assert.equal(toYou("a a", pairs), "b b");
});
