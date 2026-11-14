// The review pages' markup contract, as pure functions a round's build script calls. assets/review.js reads exactly this markup.
//   page({ round, stage, title, lede, tabs, lang, extraBox })   the whole document
//   ask({ id, kind, q, why, options, proposal, optional, settled })   a question: choice, multi or text
//   items({ scale, fallback, setAll, rows })                     rows the reader marks on a scale
//   comment(id)                                                  an attribute that gives any block a comment box
//   figure / shot / pair                                         a drawing, a screenshot, two side by side
//   counts(html)                                                 asks, rows and pictures read back from the markup
// Fields named html or ending in Html (and pair's left and right) are trusted markup; every other field is escaped.
// Every kit class is prefixed rv-, so a page that embeds other markup cannot collide with the kit's styles.

const ID = /^[a-z0-9][a-z0-9.-]*$/i;
const ROUND_ID = /^\d{2}-[a-z][a-z0-9]*-\d+$/;
const CHIP_KIND = /^[a-z0-9-]+$/i;
const KINDS = ["choice", "multi", "text"];
const DEFAULT_LANG = "en";
const EXTRA_LABEL = "Anything else, about this page or how we are working";
const KIT_PATH = "../kit";

export const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const checked = (id) => {
  if (!ID.test(String(id))) throw new Error(`"${id}" is not a usable id: letters, digits, dots and dashes only`);
  return String(id);
};
const needText = (what, value) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${what} needs alt text: say what the picture shows`);
  return value;
};

/** `data-comment="<id>"`: put it on a block's opening tag to give that block a comment box. */
export const comment = (id) => `data-comment="${checked(id)}"`;

/**
 * A question. options: [{ value, label, detail?, rec? }] for "choice" and "multi"; proposal: a drafted answer
 * (plain text, blank lines split paragraphs) for "text". settled: { decision, text } shows a decision already made
 * instead of the options, and the client records it as answered.
 */
export const ask = ({ id, kind = "text", q, why = "", options = [], proposal = "", optional = false, settled = null }) => {
  checked(id);
  if (!KINDS.includes(kind)) throw new Error(`ask ${id}: kind "${kind}" is not choice, multi or text`);
  if (settled && !(settled.decision !== undefined && settled.decision !== null && String(settled.text ?? "").trim())) {
    throw new Error(`ask ${id}: settled needs a decision number and its text`);
  }
  const head = `<article class="rv-ask" data-id="${id}" data-kind="${kind}"${settled ? ` data-settled="${esc(settled.decision)}"` : optional ? " data-optional" : ""}>`
    + `<h3>${esc(q)}</h3>${why ? `<p class="rv-why">${esc(why)}</p>` : ""}`;
  if (settled) return `${head}<div class="rv-settled"><b>Settled in decision ${esc(settled.decision)}.</b> ${esc(settled.text)}</div></article>`;
  if (kind !== "text" && options.length < 2) throw new Error(`ask ${id}: a ${kind} needs at least two options`);
  const seen = new Set();
  const list = options.map((o) => {
    const value = checked(o.value);
    if (seen.has(value)) throw new Error(`ask ${id}: option value "${value}" twice`);
    seen.add(value);
    return `<li data-value="${esc(value)}"${o.rec ? " data-rec" : ""}>${esc(o.label)}${o.detail ? `<small>${esc(o.detail)}</small>` : ""}</li>`;
  }).join("");
  const draft = proposal ? `<div class="rv-proposal">${proposal.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join("")}</div>` : "";
  return `${head}${list ? `<ul class="rv-options">${list}</ul>` : ""}${draft}</article>`;
};

/**
 * Rows to mark. scale: [{ value, label }]; fallback: the value a row holds when left untouched (a row's own
 * `fallback` overrides it); rows: [{ id, key?, name, desc?, bodyHtml?, chip?, fallback?, withdrawn? }].
 * Scale labels may not hold a comma or colon: the page stores the scale in one attribute and splits on them.
 */
export const items = ({ scale, fallback = "", setAll = false, rows }) => {
  if (!scale?.length) throw new Error("items: a scale is needed");
  const unusable = scale.find((s) => /[,:]/.test(s.label));
  if (unusable) throw new Error(`items: the label "${unusable.label}" holds a comma or colon, which the page reads as separators`);
  const values = scale.map((s) => checked(s.value));
  const onScale = (value) => {
    if (value && !values.includes(value)) throw new Error(`items: fallback "${value}" is not on the scale (${values.join(", ")})`);
    return value;
  };
  onScale(fallback);
  const seen = new Set();
  const row = (r) => {
    const id = checked(r.id);
    if (seen.has(id)) throw new Error(`items: row id "${id}" twice`);
    seen.add(id);
    const chip = r.chip ? `<span class="rv-chip${r.chip.kind ? ` rv-${chipKind(r.chip.kind)}` : ""}">${esc(r.chip.text)}</span>` : "";
    const body = `<div class="rv-body"><span class="rv-name">${esc(r.name)}</span>${chip}`
      + (r.desc ? `<div class="rv-desc">${esc(r.desc)}</div>` : "") + (r.bodyHtml ?? "") + `</div>`;
    const key = `<span class="rv-key">${esc(r.key ?? "")}</span>`;
    if (r.withdrawn) return `<div class="rv-item-off rv-withdrawn">${key}${body}</div>`;
    return `<div class="rv-item" data-id="${id}"${r.fallback ? ` data-default="${esc(onScale(r.fallback))}"` : ""}>${key}${body}</div>`;
  };
  const scaleAttr = scale.map((s) => `${s.value}:${esc(s.label)}`).join(",");
  return `<div class="rv-items" data-scale="${scaleAttr}"${fallback ? ` data-default="${esc(fallback)}"` : ""}${setAll ? " data-setall" : ""}>${rows.map(row).join("")}</div>`;
};
const chipKind = (kind) => {
  if (!CHIP_KIND.test(kind)) throw new Error(`items: chip kind "${kind}" is not letters, digits and dashes`);
  return kind;
};

const caption = (text, cls = "") => (text ? `<figcaption${cls}>${esc(text)}</figcaption>` : "");

/**
 * A drawing isolated from the kit's CSS by declarative shadow DOM: the drawing's own css lives in the template and
 * nothing outside can reach it. `html` and `css` are trusted; alt is required because the drawing is not text.
 */
export const figure = ({ html, css = "", caption: text = "", alt }) => {
  needText("a figure", alt);
  if (/<\/style/i.test(css)) throw new Error("figure: the css closes the style element");
  if (/<\/template/i.test(html ?? "")) throw new Error("figure: the html closes the template element");
  if (/@import/i.test(css)) throw new Error("figure: @import would load from outside the page");
  if (/url\(\s*["']?(https?:)?\/\//i.test(css)) throw new Error("figure: the css points at an external address");
  return `<figure class="rv-figure" role="img" aria-label="${esc(alt)}"><div><template shadowrootmode="open"><style>${css}</style>${html ?? ""}</template></div>${caption(text)}</figure>`;
};

/** A screenshot with alt text that links to the full image. `src` is a path relative to the page, never an address. */
export const shot = ({ src, alt, caption: text = "", width }) => {
  needText("a shot", alt);
  if (typeof src !== "string" || !src || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) throw new Error(`shot: "${src}" is not a relative path`);
  if (width !== undefined && !(Number.isInteger(width) && width > 0)) throw new Error(`shot: width "${width}" is not a positive whole number of pixels`);
  return `<figure class="rv-shot"><a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="${esc(alt)}"${width ? ` width="${width}"` : ""} loading="lazy"></a>${caption(text)}</figure>`;
};

/** Two figures or shots side by side (desktop and phone, before and after); stacks on a narrow screen. left and right are trusted markup. */
export const pair = ({ left, right, labels, caption: text = "" }) => {
  if (!left || !right) throw new Error("pair: needs both a left and a right");
  if (labels && labels.length !== 2) throw new Error("pair: labels need two labels, one for each side");
  const side = (inner, i) => `<div class="rv-pair-side">${labels ? `<span class="rv-pair-label">${esc(labels[i])}</span>` : ""}${inner}</div>`;
  return `<div class="rv-pair"><div class="rv-pair-grid">${side(left, 0)}${side(right, 1)}</div>${text ? `<p class="rv-caption">${esc(text)}</p>` : ""}</div>`;
};

const tally = (html, re) => (html.match(re) ?? []).length;
/** Asks, rows and pictures (drawings and screenshots) in some markup: for the closing log line, never typed by hand. */
export const counts = (html) => ({
  asks: tally(html, /<article class="rv-ask"/g),
  items: tally(html, /<div class="rv-item" /g),
  figures: tally(html, /<figure class="rv-(figure|shot)"/g),
});

const firstTwice = (html, re) => {
  const seen = new Set();
  for (const [, id] of html.matchAll(re)) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
};
const refuseTwice = (html) => {
  for (const [what, re] of [["ask", /<article class="rv-ask" data-id="([^"]*)"/g], ["row", /<div class="rv-item" data-id="([^"]*)"/g], ["comment", /data-comment="([^"]*)"/g]]) {
    const id = firstTwice(html, re);
    if (id !== null) throw new Error(`page: ${what} id "${id}" twice; answers are stored by id, so one would overwrite the other`);
  }
};

/** The whole review document. tabs: [{ id, title, html }]. The css and js are served from the kit, one level up. */
export const page = ({ round, stage = "", title, lede = "", tabs, lang = DEFAULT_LANG, extraBox = true }) => {
  if (!ROUND_ID.test(String(round))) throw new Error(`"${round}" is not a round id: two digits, a lower-case word and a number, like 01-prd-1`);
  if (!tabs?.length) throw new Error("page: needs at least one tab");
  const ids = new Set();
  for (const t of tabs) {
    if (ids.has(checked(t.id))) throw new Error(`page: tab id "${t.id}" twice`);
    ids.add(t.id);
  }
  const body = tabs.map((t) => `<section class="rv-tab" id="tab-${t.id}" data-title="${esc(t.title)}">${t.html}</section>`).join("\n");
  refuseTwice(body);
  const extra = extraBox
    ? `<div class="rv-extra"><label for="rv-extra">${EXTRA_LABEL}</label><textarea data-extra id="rv-extra" rows="3"></textarea></div>\n`
    : "";
  // A tab's id is prefixed so a link to #<tab> selects the tab without the browser jumping to it.
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${KIT_PATH}/review.css">
</head>
<body class="rv-page" data-round="${round}">
<header class="rv-top">
${stage ? `<p class="rv-stage">${esc(stage)}</p>\n` : ""}<h1>${esc(title)}</h1>
${lede ? `<p class="rv-lede">${esc(lede)}</p>\n` : ""}</header>
<main>
${body}
</main>
${extra}<script src="${KIT_PATH}/review.js"></script>
</body>
</html>
`;
};
