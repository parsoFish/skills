// Page parts a round's build script composes from documents and records, so a page is assembled from the sources
// rather than retyped (and cannot drift from them):
//   md, sections      markdown as HTML, and a document split into its sections (from markdown.mjs)
//   docTab            a document as a tab: one block per section, each with a comment box
//   folded            a collapsed block
//   teardown          rows for picking apart what exists today, defaulting to the proposed verdict
//   sinceTab          the decisions a round's answers became (parses DECISIONS.md)
//   lockPage          a lock page body: what changed, what is unproven, risks, a row per document, the lock ask
//   toYou             third person to second person, failing the build if any phrase survives
import { ask, comment, esc, items } from "./render.mjs";
import { inline, md, sections, slugOf } from "./markdown.mjs";

export { inline, md, sections, slugOf };

export const KEEP_REWORK_MERGE_DROP = Object.freeze([
  { value: "keep", label: "Keep" }, { value: "rework", label: "Rework" }, { value: "merge", label: "Merge" }, { value: "drop", label: "Drop" },
]);
const LOCK_SCALE = Object.freeze([{ value: "lock", label: "Lock" }, { value: "not-yet", label: "Not yet" }]);
const MAX_CHANGED_LINE = 400;
const NOT_A_PATH = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

const block = (id, inner, comments = true) => `<div class="rv-block"${comments ? ` ${comment(id)}` : ""}>${inner}</div>`;
const list = (lines) => `<ul>${lines.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`;

/** A document as a tab's html: its title, then one block per `##` section with a comment box (`sec.<id>.<slug>`). */
export const docTab = ({ id, title = "", markdown, comments = true }) => {
  const prefix = `sec.${id}`;
  comment(prefix); // fails fast on an id the page could not address
  const parts = sections(markdown);
  const body = parts.map((p) => {
    if (p.level === 2) return block(`${prefix}.${p.slug}`, `<h3>${inline(p.title)}</h3>\n${md(p.body)}`, comments);
    return p.body ? md(p.body) : "";
  }).filter(Boolean);
  return [title ? `<h2>${esc(title)}</h2>` : "", ...body].filter(Boolean).join("\n");
};

/** A collapsed block. `html` is trusted markup. */
export const folded = (title, html, open = false) => `<details class="rv-folded"${open ? " open" : ""}><summary>${esc(title)}</summary>${html}</details>`;

/**
 * Rows for picking apart what exists today: rows [{ id, name, verdict, what, goes }]. Each row starts on the proposed
 * verdict, so the reader touches only the exceptions.
 */
export const teardown = ({ rows, scale = KEEP_REWORK_MERGE_DROP }) => {
  if (!rows?.length) throw new Error("teardown: needs at least one row");
  const values = scale.map((s) => s.value);
  return items({
    scale: [...scale],
    rows: rows.map((r) => {
      if (!values.includes(r.verdict)) throw new Error(`teardown: row ${r.id}: verdict "${r.verdict}" is not on the scale (${values.join(", ")})`);
      return { id: r.id, name: r.name, desc: r.what, fallback: r.verdict, bodyHtml: `<div class="rv-desc"><b>Proposed.</b> ${esc(r.goes)}</div>` };
    }),
  });
};

const cellsOf = (line) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replaceAll("\\|", "|"));

/**
 * The rows of a DECISIONS.md table: [{ n, date, kind, track, text, source, replaces }]. Reads the current six columns
 * (# | Date | Kind | Track | Decision | Source) and the older five (# | date | stage | decision | source).
 */
export const parseDecisions = (decisionsMd) => {
  if (typeof decisionsMd !== "string") throw new TypeError("decisionsMd must be a string");
  return decisionsMd.split(/\r?\n/).filter((l) => l.trim().startsWith("|")).flatMap((line) => {
    const c = cellsOf(line);
    if (!/^\d+$/.test(c[0]) || c.length < 4) return [];
    const text = c.at(-2);
    const six = c.length >= 6;
    const replaces = /\(replaces (\d+)\)\s*$/.exec(text)?.[1];
    return [{ n: Number(c[0]), date: c[1], kind: six ? c[2] : "", track: six ? c[3] : "", text, source: c.at(-1), replaces: replaces ? Number(replaces) : null }];
  });
};

/** [11, 12, 13, 15] as "11 to 13 and 15". */
const numbersText = (nums) => {
  const runs = nums.reduce((acc, n) => (acc.at(-1)?.at(-1) === n - 1 ? [...acc.slice(0, -1), [...acc.at(-1), n]] : [...acc, [n]]), []);
  const text = runs.map((r) => (r.length > 1 ? `${r[0]} to ${r.at(-1)}` : String(r[0])));
  return text.length > 1 ? `${text.slice(0, -1).join(", ")} and ${text.at(-1)}` : text[0];
};

/** What the last round's answers became: the DECISIONS.md rows whose Source names one of `rounds`. */
export const sinceTab = ({ decisionsMd, rounds, title = "Since last time" }) => {
  if (!rounds?.length) throw new Error("sinceTab: needs at least one round");
  const rows = parseDecisions(decisionsMd).filter((r) => r.source.split(/[\s,;]+/).some((t) => rounds.includes(t)));
  const head = `<h2>${esc(title)}</h2>`;
  if (!rows.length) return block("sec.since", `${head}<p>No decision was recorded from ${esc(rounds.join(", "))}.</p>`);
  const nums = rows.map((r) => r.n).sort((a, b) => a - b);
  const intro = `<p>Your answers became decision${nums.length > 1 ? "s" : ""} ${numbersText(nums)}.</p>`;
  const body = rows.map((r) => `<tr><td>${r.n}</td><td>${inline(r.text)}</td><td>${esc(r.source)}</td></tr>`).join("");
  return block("sec.since", `${head}${intro}<div class="rv-tablewrap"><table><thead><tr><th>#</th><th>Decision</th><th>Source</th></tr></thead><tbody>${body}</tbody></table></div>`);
};

const DEFAULT_LOCK_ASK = {
  id: "lock", kind: "choice", q: "Lock these documents?",
  why: "Locked, they change only by a new decision. Mark a row Not yet to hold one back, and say why in its note.",
  options: [{ value: "lock", label: "Lock it", rec: true }, { value: "not-yet", label: "Not yet", detail: "Say what is missing in the note" }],
};

const changedLines = (doc) => (doc.changedSince ?? []).map((line) => {
  if (typeof line !== "string" || line.includes("\n") || line.length > MAX_CHANGED_LINE) {
    throw new Error(`lockPage: "${doc.name}": a changed line is one short line (under ${MAX_CHANGED_LINE} characters); link the document instead of copying it`);
  }
  return line;
});

/**
 * A lock page body: what changed in each document since the last agreed draft, what is unproven, the risks, one
 * Lock / Not yet row per document, and the lock ask. documents: [{ name, path, changedSince?: [line], link? }].
 * It never renders a document: only its name, path, link and the lines said to have changed.
 */
export const lockPage = ({ documents, unproven = [], risks = [], ask: lockAsk = DEFAULT_LOCK_ASK }) => {
  if (!documents?.length) throw new Error("lockPage: needs at least one document");
  const changed = documents.map((d) => {
    const lines = changedLines(d);
    return `<h3>${esc(d.name)}</h3>${lines.length ? list(lines) : "<p>No change since the last agreed draft.</p>"}`;
  }).join("");
  const rows = documents.map((d) => {
    if (d.link && NOT_A_PATH.test(d.link)) throw new Error(`lockPage: "${d.name}": link "${d.link}" is not a relative path`);
    return { id: `doc.${slugOf(d.name)}`, name: d.name, desc: d.path, bodyHtml: d.link ? `<div class="rv-desc"><a href="${esc(d.link)}">Open the document</a></div>` : "" };
  });
  const listOr = (title, lines, none) => `<h2>${title}</h2>${lines.length ? list(lines) : `<p>${none}</p>`}`;
  return [
    block("sec.lock.changed", `<h2>What changed since the last agreed draft</h2>${changed}`),
    block("sec.lock.unproven", listOr("What is still unproven", unproven, "Nothing is listed as unproven.")),
    block("sec.lock.risks", listOr("Risks", risks, "No risks are listed.")),
    block("sec.lock.docs", `<h2>The documents</h2><p>The underlined choice is the proposal. Mark Not yet on a document you want held back.</p>${items({ scale: [...LOCK_SCALE], fallback: "lock", rows })}`),
    block("sec.lock.ask", `<h2>The lock</h2>${ask(lockAsk)}`),
  ].join("\n");
};

/**
 * Third person to second person: replaces each `from` in `pairs` ([[from, to], ...]) with its `to`, then throws if any
 * `from` is still present, so a page cannot ship a line that names the person it speaks to.
 */
export const toYou = (text, pairs = []) => {
  for (const pair of pairs) {
    if (!Array.isArray(pair) || typeof pair[0] !== "string" || !pair[0] || typeof pair[1] !== "string") throw new Error("toYou: each pair needs a phrase to replace and its replacement, like [\"Sam's\", \"your\"]");
  }
  const turned = pairs.reduce((t, [from, to]) => t.split(from).join(to), text);
  const left = pairs.find(([from]) => turned.includes(from));
  if (left) throw new Error(`toYou: the text still names "${left[0]}": ${turned.slice(0, 120)}`);
  return turned;
};
