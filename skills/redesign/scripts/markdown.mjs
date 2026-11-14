// The small part of markdown a project's documents use, as HTML for a review page: headings, paragraphs, bullet and
// numbered lists (nested, and continuing after a table or code fence), tables, fenced code, quotes, and inline code,
// bold, italic and links. Text is escaped first, so a document cannot inject markup.
import { esc } from "./render.mjs";

const SLUG_MAX = 40;
const MARKER = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const SEPARATOR = /^\|(\s*:?-+:?\s*\|)+$/;
const SAFE_ABSOLUTE = /^(https?:\/\/|mailto:)/i;
const HAS_SCHEME_OR_HOST = /^([a-z][a-z0-9+.-]*:|\/\/)/i;
const TOKEN = /\u0000(\d+)\u0000/g;

export const slugOf = (text) => {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, SLUG_MAX).replace(/-+$/, "");
  return slug || "section";
};

const emphasis = (s) => s
  .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<b>$1</b>")
  .replace(/\*(?=\S)([^*]+?)(?<=\S)\*/g, "<i>$1</i>")
  .replace(/(^|[^\w])_(?=\S)([^_]+?)(?<=\S)_(?!\w)/g, "$1<i>$2</i>");

/** One line or paragraph of markdown as inline HTML. Code and links are set aside first so nothing reads inside them. */
export const inline = (text) => {
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let s = esc(String(text).replaceAll("\u0000", ""));
  s = s.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`));
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, label, href) => {
    const body = emphasis(label);
    // esc turned any quote or angle bracket in the address into an entity; an address holding one is not one to follow.
    if (/&(quot|lt|gt|#39);/.test(href)) return keep(body);
    if (SAFE_ABSOLUTE.test(href)) return keep(`<a href="${href}" target="_blank" rel="noopener noreferrer">${body}</a>`);
    if (HAS_SCHEME_OR_HOST.test(href)) return keep(body);
    return keep(`<a href="${href}">${body}</a>`);
  });
  s = emphasis(s);
  while (TOKEN.test(s)) s = s.replace(TOKEN, (_, n) => stash[Number(n)]);
  return s;
};

const cells = (line) => {
  const inner = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replaceAll("\\|", "|"));
};
const isTableStart = (lines, i) => lines[i].trim().startsWith("|") && i + 1 < lines.length && SEPARATOR.test(lines[i + 1].trim());
const isBlockStart = (lines, i) => {
  const line = lines[i];
  return HEADING.test(line) || FENCE.test(line) || RULE.test(line) || /^\s{0,3}>/.test(line) || MARKER.test(line) || isTableStart(lines, i);
};

const table = (rows) => {
  const [head, , ...body] = rows;
  const header = cells(head);
  const thead = header.some(Boolean) ? `<thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` : "";
  const tbody = body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
  return `<div class="rv-tablewrap"><table>${thead}<tbody>${tbody}</tbody></table></div>`;
};

// Items at the list's own indent become <li>s; deeper marker lines nest, and any other line wraps the item above it.
const listHtml = (lines) => {
  const base = MARKER.exec(lines[0])[1].length;
  const entries = [];
  for (const line of lines) {
    const m = MARKER.exec(line);
    const last = entries.at(-1);
    if (m && m[1].length <= base) entries.push({ ordered: /\d/.test(m[2]), num: parseInt(m[2], 10), text: [m[3]], kids: [] });
    else if (m || last.kids.length) last.kids.push(line);
    else last.text.push(line.trim());
  }
  const groups = entries.reduce((acc, e) => (acc.at(-1)?.ordered === e.ordered ? [...acc.slice(0, -1), { ...acc.at(-1), entries: [...acc.at(-1).entries, e] }] : [...acc, { ordered: e.ordered, entries: [e] }]), []);
  return groups.map((g) => {
    const li = g.entries.map((e) => `<li>${inline(e.text.join(" "))}${e.kids.length ? listHtml(e.kids) : ""}</li>`).join("");
    if (!g.ordered) return `<ul>${li}</ul>`;
    const start = g.entries[0].num;
    return `<ol${start === 1 ? "" : ` start="${start}"`}>${li}</ol>`;
  }).join("");
};

const blocks = (lines, base) => {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const [, mark, info] = fence;
      const body = [];
      i += 1;
      while (i < lines.length && !(lines[i].trim().startsWith(mark[0].repeat(mark.length)) && /^[`~]+\s*$/.test(lines[i].trim()))) body.push(lines[i++]);
      if (i >= lines.length) while (body.length && !body.at(-1).trim()) body.pop(); // unclosed: the split's trailing blank is not code
      i += 1;
      const lang = info.trim();
      out.push(`<pre><code${/^[\w+-]+$/.test(lang) ? ` class="language-${lang}"` : ""}>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(6, base + heading[1].length - 1);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
    } else if (RULE.test(line)) {
      out.push("<hr>");
      i += 1;
    } else if (isTableStart(lines, i)) {
      const rows = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      out.push(table(rows));
    } else if (/^\s{0,3}>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s{0,3}> ?/, ""));
      out.push(`<blockquote>${blocks(quoted, base).join("\n")}</blockquote>`);
    } else if (MARKER.test(line)) {
      const run = [];
      while (i < lines.length) {
        if (!lines[i].trim()) {
          const next = lines.slice(i).findIndex((l) => l.trim());
          if (next < 0 || !(MARKER.test(lines[i + next]) || /^\s{2,}\S/.test(lines[i + next])) || FENCE.test(lines[i + next])) break;
          i += next;
          continue;
        }
        const indented = /^\s{2,}\S/.test(lines[i]);
        if (FENCE.test(lines[i]) || (!indented && !MARKER.test(lines[i]) && isBlockStart(lines, i))) break;
        run.push(lines[i++]);
      }
      out.push(listHtml(run));
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines, i))) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
  }
  return out;
};

/** Markdown as HTML. headingBase is the tag level a `#` becomes (default 2, under the page's own h1); `##` is one deeper. */
export const md = (markdown, { headingBase = 2 } = {}) => {
  if (typeof markdown !== "string") throw new TypeError("markdown must be a string");
  return blocks(markdown.split(/\r?\n/), headingBase).join("\n");
};

/**
 * A document's parts: [{ level, title, slug, body }], one per `#` or `##` heading (a `###` stays inside its section's
 * body). Text before the first heading comes back as level 0 with an empty title. Slugs are unique within the document.
 */
export const sections = (markdown) => {
  if (typeof markdown !== "string") throw new TypeError("markdown must be a string");
  const parts = [{ level: 0, title: "", slug: "", lines: [] }];
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (f && (fence === null || (f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()))) fence = fence === null ? f[1] : null;
    const head = fence === null && !f ? /^(#{1,2})\s+(.+?)\s*$/.exec(line) : null;
    if (head) parts.push({ level: head[1].length, title: head[2], slug: "", lines: [] });
    else parts.at(-1).lines.push(line);
  }
  const used = new Map();
  return parts.map(({ lines, ...part }) => ({ ...part, body: lines.join("\n").replace(/^\n+|\s+$/g, "") }))
    .filter((p) => p.level > 0 || p.body)
    .map((p) => {
      if (!p.level) return p;
      const base = slugOf(p.title);
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      return { ...p, slug: n === 1 ? base : `${base}-${n}` };
    });
};
