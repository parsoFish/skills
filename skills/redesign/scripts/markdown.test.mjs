import { test } from "node:test";
import assert from "node:assert/strict";
import { inline, md, sections, slugOf } from "./markdown.mjs";

test("headings shift under the page's own h1, and paragraphs join their lines", () => {
  assert.equal(md("# Title\n\n## Part\n\n### Sub\n\nOne line\nsecond line"),
    "<h2>Title</h2>\n<h3>Part</h3>\n<h4>Sub</h4>\n<p>One line second line</p>");
  assert.equal(md("## Part", { headingBase: 1 }), "<h2>Part</h2>");
  assert.equal(md("###### deep", { headingBase: 3 }), "<h6>deep</h6>");
});

test("inline code, bold, italic and links are read, and everything else is escaped", () => {
  assert.equal(inline("a **b** and *c* and _d_ and `<e>`"), "a <b>b</b> and <i>c</i> and <i>d</i> and <code>&lt;e&gt;</code>");
  assert.equal(inline("snake_case_name stays"), "snake_case_name stays");
  assert.equal(inline("<script>x</script> & more"), "&lt;script&gt;x&lt;/script&gt; &amp; more");
  assert.equal(inline("**`code` inside**"), "<b><code>code</code> inside</b>");
  assert.equal(inline("`**not bold**`"), "<code>**not bold**</code>");
});

test("links keep safe addresses and drop the rest to plain text", () => {
  assert.equal(inline("[docs](https://x.test/a_b?c=1&d=2)"), `<a href="https://x.test/a_b?c=1&amp;d=2" target="_blank" rel="noopener noreferrer">docs</a>`);
  assert.equal(inline("[here](../other.md#top)"), `<a href="../other.md#top">here</a>`);
  assert.equal(inline("[bad](javascript:alert(1))"), "bad");
  assert.equal(inline(`[q](x"onclick="y)`), "q");
});

test("bullet lists, with nesting and wrapped lines", () => {
  assert.equal(md("- one\n- two\n  wrapped\n  - nested a\n  - nested b\n- three"),
    "<ul><li>one</li><li>two wrapped<ul><li>nested a</li><li>nested b</li></ul></li><li>three</li></ul>");
  assert.equal(md("* a\n+ b"), "<ul><li>a</li><li>b</li></ul>");
});

test("a blank line between items does not split a list", () => {
  assert.equal(md("1. a\n\n2. b\n\n3. c"), `<ol><li>a</li><li>b</li><li>c</li></ol>`);
});

test("a numbered list continues after a table (it used to restart at 1)", () => {
  const out = md("1. first\n2. second\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n3. third\n4. fourth");
  assert.match(out, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(out, /<table>/);
  assert.match(out, /<ol start="3"><li>third<\/li><li>fourth<\/li><\/ol>$/);
});

test("a numbered list continues after a code fence", () => {
  const out = md("1. install\n\n```sh\nnpm i\n```\n\n2. run");
  assert.match(out, /<pre><code class="language-sh">npm i<\/code><\/pre>\n<ol start="2"><li>run<\/li><\/ol>$/);
});

test("tables need a dash separator; a header left empty on purpose is kept off, not dropped as data", () => {
  assert.equal(md("| a | b |\n|---|:-:|\n| 1 | 2 |"),
    `<div class="rv-tablewrap"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>`);
  assert.equal(md("| | |\n|---|---|\n| x | y |"),
    `<div class="rv-tablewrap"><table><tbody><tr><td>x</td><td>y</td></tr></tbody></table></div>`);
  // No separator row: it is not a table, so it stays readable text.
  assert.equal(md("| a | b |\n| 1 | 2 |"), "<p>| a | b | | 1 | 2 |</p>");
});

test("table cells split on unescaped pipes only, and are escaped", () => {
  assert.match(md("| a \\| b | <i> |\n|---|---|\n| `x` | **y** |"), /<th>a \| b<\/th><th>&lt;i&gt;<\/th>.*<td><code>x<\/code><\/td><td><b>y<\/b><\/td>/);
});

test("fenced code is escaped, keeps its blank lines and may run to the end of the text", () => {
  assert.equal(md("```\n<a>\n\n# not a heading\n```"), "<pre><code>&lt;a&gt;\n\n# not a heading</code></pre>");
  assert.equal(md("~~~js\nlet x\n"), `<pre><code class="language-js">let x</code></pre>`);
  assert.equal(md("```we ird!\nx\n```"), "<pre><code>x</code></pre>");
});

test("quotes, rules and empty input", () => {
  assert.equal(md("> quoted\n> text"), "<blockquote><p>quoted text</p></blockquote>");
  assert.equal(md("a\n\n---\n\nb"), "<p>a</p>\n<hr>\n<p>b</p>");
  assert.equal(md(""), "");
  assert.equal(md("\r\n\r\n"), "");
  assert.equal(md("a\r\nb"), "<p>a b</p>");
  assert.throws(() => md(null), /markdown must be a string/);
});

test("sections split at # and ## headings, keep ### inside, and give a unique slug", () => {
  const out = sections("Preface line\n\n# Title\n\nIntro\n\n## Scope & aims\n\ntext\n\n### Detail\n\nmore\n\n## Scope & aims\n\n```\n## not a heading\n```\n\n## Next");
  assert.deepEqual(out.map(({ level, title, slug }) => [level, title, slug]), [
    [0, "", ""], [1, "Title", "title"], [2, "Scope & aims", "scope-aims"], [2, "Scope & aims", "scope-aims-2"], [2, "Next", "next"],
  ]);
  assert.equal(out[0].body, "Preface line");
  assert.equal(out[2].body, "text\n\n### Detail\n\nmore");
  assert.match(out[3].body, /## not a heading/);
});

test("sections returns nothing for empty text and drops an empty preface", () => {
  assert.deepEqual(sections(""), []);
  assert.deepEqual(sections("## A\n\nb").map((s) => s.title), ["A"]);
});

test("slugOf is lower-case words joined by dashes, capped, and never empty", () => {
  assert.equal(slugOf("  Hello, World! 2 "), "hello-world-2");
  assert.equal(slugOf("x".repeat(80)).length, 40);
  assert.equal(slugOf("!!!"), "section");
});
