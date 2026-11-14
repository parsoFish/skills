import { test } from "node:test";
import assert from "node:assert/strict";
import { ask, comment, counts, esc, figure, items, page, pair, shot } from "./render.mjs";

test("esc escapes the five characters that end text or an attribute", () => {
  assert.equal(esc(`<a href="x">Tom & Jerry's</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
  assert.equal(esc(undefined), "");
  assert.equal(esc(0), "0");
});

test("comment gives a block its comment hook and refuses an id the page cannot address", () => {
  assert.equal(comment("sec.scope"), `data-comment="sec.scope"`);
  assert.throws(() => comment("has space"), /not a usable id/);
});

test("a choice marks its recommended option and escapes the reader-facing text", () => {
  const html = ask({
    id: "q.scope", kind: "choice", q: "Core first, or <everything>?",
    options: [{ value: "core", label: "Core first", detail: "sessions & fleet", rec: true }, { value: "all", label: "Everything" }],
  });
  assert.equal(html,
    `<article class="rv-ask" data-id="q.scope" data-kind="choice"><h3>Core first, or &lt;everything&gt;?</h3>`
    + `<ul class="rv-options"><li data-value="core" data-rec>Core first<small>sessions &amp; fleet</small></li>`
    + `<li data-value="all">Everything</li></ul></article>`);
});

test("a text ask carries its draft as paragraphs and can be optional", () => {
  const html = ask({ id: "q.problem", q: "Why rebuild?", proposal: "It grew.\n\nIt was never designed.", optional: true });
  assert.equal(html,
    `<article class="rv-ask" data-id="q.problem" data-kind="text" data-optional><h3>Why rebuild?</h3>`
    + `<div class="rv-proposal"><p>It grew.</p><p>It was never designed.</p></div></article>`);
});

test("a settled ask shows the decision instead of options and is marked for the client", () => {
  const html = ask({
    id: "q.router", kind: "choice", q: "What does the router do?", why: "Asked before.",
    options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    settled: { decision: 12, text: "The router only <routes>." },
  });
  assert.match(html, /^<article class="rv-ask" data-id="q\.router" data-kind="choice" data-settled="12">/);
  assert.match(html, /<div class="rv-settled">.*decision 12.*The router only &lt;routes&gt;\.<\/div>/);
  assert.doesNotMatch(html, /rv-options/);
  assert.doesNotMatch(html, /data-optional/);
});

test("a settled ask needs no options and refuses a decision without a number or text", () => {
  assert.match(ask({ id: "q.s", kind: "choice", q: "x", settled: { decision: 3, text: "done" } }), /data-settled="3"/);
  assert.throws(() => ask({ id: "q.s", q: "x", settled: { text: "done" } }), /settled needs a decision number and its text/);
  assert.throws(() => ask({ id: "q.s", q: "x", settled: { decision: 3 } }), /settled needs a decision number and its text/);
});

test("an ask refuses an id the page could not address, a bad kind, and a choice with one option", () => {
  assert.throws(() => ask({ id: "q scope", q: "x" }), /not a usable id/);
  assert.throws(() => ask({ id: "q.one", kind: "choice", q: "x", options: [{ value: "a", label: "A" }] }), /at least two options/);
  assert.throws(() => ask({ id: "q.kind", kind: "rank", q: "x" }), /not choice, multi or text/);
  assert.throws(() => ask({ id: "q.dup", kind: "choice", q: "x", options: [{ value: "a", label: "A" }, { value: "a", label: "B" }] }), /twice/);
});

test("rows take the group's scale and fallback, a row's own fallback wins, a withdrawn row cannot be marked", () => {
  const html = items({
    scale: [{ value: "keep", label: "Keep" }, { value: "drop", label: "Drop" }], fallback: "keep", setAll: true,
    rows: [
      { id: "story.C-01", key: "C-01", name: "A request flow", chip: { kind: "partial", text: "partial" } },
      { id: "story.C-06", key: "C-06", name: "Triage from outside", fallback: "drop" },
      { id: "story.C-22", key: "C-22", name: "withdrawn: cost split", withdrawn: true },
    ],
  });
  assert.equal(html,
    `<div class="rv-items" data-scale="keep:Keep,drop:Drop" data-default="keep" data-setall>`
    + `<div class="rv-item" data-id="story.C-01"><span class="rv-key">C-01</span><div class="rv-body"><span class="rv-name">A request flow</span><span class="rv-chip rv-partial">partial</span></div></div>`
    + `<div class="rv-item" data-id="story.C-06" data-default="drop"><span class="rv-key">C-06</span><div class="rv-body"><span class="rv-name">Triage from outside</span></div></div>`
    + `<div class="rv-item-off rv-withdrawn"><span class="rv-key">C-22</span><div class="rv-body"><span class="rv-name">withdrawn: cost split</span></div></div>`
    + `</div>`);
});

test("rows carry a description and trusted body markup", () => {
  const html = items({ scale: [{ value: "a", label: "A" }, { value: "b", label: "B" }], rows: [{ id: "r1", name: "N", desc: "d <x>", bodyHtml: "<p>more</p>" }] });
  assert.match(html, /<div class="rv-desc">d &lt;x&gt;<\/div><p>more<\/p><\/div><\/div>/);
});

test("a scale label the page would misread is refused when the page is built", () => {
  assert.throws(() => items({ scale: [{ value: "keep", label: "Keep, as is" }], rows: [] }), /comma or colon/);
  assert.throws(() => items({ scale: [{ value: "keep", label: "Keep: as is" }], rows: [] }), /comma or colon/);
});

test("items fail fast on a missing scale, a fallback off the scale, or a duplicate row", () => {
  const scale = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  assert.throws(() => items({ scale: [], rows: [] }), /scale is needed/);
  assert.throws(() => items({ scale, fallback: "z", rows: [] }), /fallback "z" is not on the scale/);
  assert.throws(() => items({ scale, rows: [{ id: "r", name: "n", fallback: "z" }] }), /fallback "z" is not on the scale/);
  assert.throws(() => items({ scale, rows: [{ id: "r", name: "n" }, { id: "r", name: "m" }] }), /row id "r" twice/);
});

test("a figure isolates its drawing in a shadow root so kit CSS cannot reach it", () => {
  const html = figure({ html: `<svg><rect/></svg>`, css: "rect{fill:red}", caption: "The <map>", alt: "A map of two boxes" });
  assert.equal(html,
    `<figure class="rv-figure" role="img" aria-label="A map of two boxes"><div><template shadowrootmode="open"><style>rect{fill:red}</style><svg><rect/></svg></template></div><figcaption>The &lt;map&gt;</figcaption></figure>`);
});

test("a figure needs alt text and refuses css that would break out or reach the network", () => {
  assert.throws(() => figure({ html: "<i></i>" }), /alt text/);
  assert.throws(() => figure({ html: "<i></i>", alt: "x", css: "</style><script>" }), /closes the style element/);
  assert.throws(() => figure({ html: "<i></i>", alt: "x", css: `@import "a.css";` }), /@import/);
  assert.throws(() => figure({ html: "<i></i>", alt: "x", css: "a{background:url(https://x.test/a.png)}" }), /external address/);
  assert.throws(() => figure({ html: "</template><b>", alt: "x" }), /closes the template element/);
});

test("a figure without a caption renders no figcaption", () => {
  assert.doesNotMatch(figure({ html: "<i></i>", alt: "x" }), /figcaption/);
});

test("a shot is an image with alt text that links to the full image", () => {
  const html = shot({ src: "_shots/home.desktop.png", alt: "Home, desktop", caption: "Home at 1280", width: 640 });
  assert.equal(html,
    `<figure class="rv-shot"><a href="_shots/home.desktop.png" target="_blank" rel="noopener"><img src="_shots/home.desktop.png" alt="Home, desktop" width="640" loading="lazy"></a><figcaption>Home at 1280</figcaption></figure>`);
});

test("a shot needs alt text, a relative path and a sane width", () => {
  assert.throws(() => shot({ src: "a.png" }), /alt text/);
  assert.throws(() => shot({ src: "https://x.test/a.png", alt: "x" }), /relative path/);
  assert.throws(() => shot({ src: "//x.test/a.png", alt: "x" }), /relative path/);
  assert.throws(() => shot({ src: "javascript:alert(1)", alt: "x" }), /relative path/);
  assert.throws(() => shot({ src: "a.png", alt: "x", width: -3 }), /width/);
});

test("a pair sets two pictures side by side with labels", () => {
  const left = shot({ src: "a.png", alt: "a" });
  const right = shot({ src: "b.png", alt: "b" });
  const html = pair({ left, right, labels: ["Desktop", "Phone"], caption: "Same page" });
  assert.match(html, /^<div class="rv-pair">/);
  assert.match(html, /<div class="rv-pair-side"><span class="rv-pair-label">Desktop<\/span>/);
  assert.match(html, /<span class="rv-pair-label">Phone<\/span>/);
  assert.ok(html.includes(left) && html.includes(right));
  assert.match(html, /<p class="rv-caption">Same page<\/p>/);
});

test("a pair needs both sides and two labels when labels are given", () => {
  assert.throws(() => pair({ left: "<i></i>" }), /both a left and a right/);
  assert.throws(() => pair({ left: "<i></i>", right: "<i></i>", labels: ["only"] }), /two labels/);
});

test("a page names its round for the client, links the kit and refuses a round the server could not serve", () => {
  const html = page({ round: "01-prd-1", stage: "Stage 1 of 5", title: "PRD & framing", tabs: [{ id: "start", title: "Start here", html: `<h2 ${comment("sec.process")}>Process</h2>` }] });
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<body class="rv-page" data-round="01-prd-1">/);
  assert.match(html, /<title>PRD &amp; framing<\/title>/);
  assert.match(html, /<link rel="stylesheet" href="\.\.\/kit\/review\.css">/);
  assert.match(html, /<script src="\.\.\/kit\/review\.js"><\/script>/);
  assert.match(html, /<section class="rv-tab" id="tab-start" data-title="Start here"><h2 data-comment="sec.process">Process<\/h2><\/section>/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.throws(() => page({ round: "01 PRD", stage: "", title: "", tabs: [] }), /not a round id/);
  assert.throws(() => page({ round: "main-1", stage: "", title: "t", tabs: [{ id: "a", title: "A", html: "" }] }), /not a round id/);
});

test("a page takes its language from the argument and shows the extra box by default", () => {
  const tabs = [{ id: "a", title: "A", html: "<p>x</p>" }];
  const html = page({ round: "02-arch-2", title: "t", lang: "fr", tabs });
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /<textarea data-extra[^>]*><\/textarea>/);
  assert.match(html, /Anything else, about this page or how we are working/);
  assert.doesNotMatch(page({ round: "02-arch-2", title: "t", tabs, extraBox: false }), /data-extra/);
});

test("a page needs a tab, refuses duplicate tab ids and duplicate ask, row or comment ids", () => {
  const tab = (id, html = "") => ({ id, title: id, html });
  const base = { round: "01-prd-1", title: "t" };
  assert.throws(() => page({ ...base, tabs: [] }), /at least one tab/);
  assert.throws(() => page({ ...base, tabs: [tab("a"), tab("a")] }), /tab id "a" twice/);
  const a = ask({ id: "q.a", q: "x" });
  assert.throws(() => page({ ...base, tabs: [tab("a", a + a)] }), /ask id "q\.a" twice/);
  const rows = items({ scale: [{ value: "a", label: "A" }, { value: "b", label: "B" }], rows: [{ id: "r1", name: "n" }] });
  assert.throws(() => page({ ...base, tabs: [tab("a", rows), tab("b", rows)] }), /row id "r1" twice/);
  const c = `<div ${comment("sec.x")}></div>`;
  assert.throws(() => page({ ...base, tabs: [tab("a", c + c)] }), /comment id "sec\.x" twice/);
});

test("a page carries no stylesheet, font or script from outside", () => {
  const html = page({ round: "01-prd-1", title: "t", lede: "l", stage: "s", tabs: [{ id: "a", title: "A", html: "" }] });
  assert.doesNotMatch(html, /(https?:)?\/\/[a-z]/i);
  assert.doesNotMatch(html, /@import/);
});

test("counts reads asks, rows and pictures from the markup, not from what the author typed", () => {
  const scale = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  const html = [
    ask({ id: "q1", q: "x" }), ask({ id: "q2", q: "x", optional: true }),
    items({ scale, rows: [{ id: "r1", name: "a" }, { id: "r2", name: "b" }, { id: "r3", name: "c", withdrawn: true }] }),
    figure({ html: "<i></i>", alt: "d" }), shot({ src: "a.png", alt: "s" }),
    pair({ left: figure({ html: "<i></i>", alt: "l" }), right: figure({ html: "<i></i>", alt: "r" }) }),
  ].join("");
  assert.deepEqual(counts(html), { asks: 2, items: 2, figures: 4 });
  assert.deepEqual(counts(""), { asks: 0, items: 0, figures: 0 });
});
