// Build a single self-contained HTML page for the human-facing bundle: rendered views, then
// written docs, then generated docs, then run artifacts (review/interview/etc.), navigable from a
// sticky file tree. Markdown and Mermaid render client-side (marked + mermaid from cdnjs); this
// module's own job is to assemble one HTML string — no fs writes here except reading the PNG
// bytes a caller points us at via `pngPath`.
import { readFileSync } from 'node:fs';
import { sanitizeId } from './model.mjs';

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap';
const MARKED_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js';
// cdnjs mirrors mermaid 11.4.1 as ESM chunks only (no root mermaid.min.js — confirmed via the
// cdnjs API and a live 404), so this pins 11.4.0, the nearest patch that still ships one.
const MERMAID_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.4.0/mermaid.min.js';

// The 10 kinds Mermaid diagrams can bind classes to (matches assets/legend.c4's colours, minus
// iacmodule and the `system` container — a diagram node is never drawn as either of those).
const KIND_COLORS = {
  human: '#6B4E9B', webui: '#1F6F78', service: '#2F5FA8', cli: '#4A5468', agent: '#C2571A',
  knowledge: '#3F7D3A', log: '#8A6D1F', workspace: '#8C5A2B', external: '#7C869A', modelapi: '#A03A6E',
};

const isDoc = p => !/\.(c4|json)$/i.test(String(p ?? ''));
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = s => esc(s).replace(/"/g, '&quot;');
// Only a genuine `</script` needs escaping to keep an embedded doc from closing its own tag early.
const scriptSafe = s => String(s ?? '').replace(/<\/(script)/gi, '<\\/$1');

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(rgb) {
  return `#${rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}
/** Linear-interpolate a house colour toward `target` by `amount` (0 = colour, 1 = target). */
function mix(hex, target, amount) {
  const a = hexToRgb(hex), b = hexToRgb(target);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * amount));
}
const paleOnLight = hex => mix(hex, '#FFFFFF', 0.86);
const paleOnDark = hex => mix(hex, '#14161B', 0.6);
const inkOnPale = hex => mix(hex, '#000000', 0.55);

/** One `classDef <kind> fill:...,stroke:...,color:...` line per house kind, pale fill + saturated
 * stroke, so any Mermaid diagram can `class someNode <kind>` and read like the rest of the kit. */
function mermaidClassDefPreamble() {
  return Object.entries(KIND_COLORS).map(([kind, hex]) => `classDef ${kind} fill:${paleOnLight(hex)},stroke:${hex},color:${inkOnPale(hex)}`).join('\n');
}

/**
 * Insert the classDef preamble inside every ```mermaid fence in `markdown`, right after the
 * diagram-type declaration (`flowchart LR`, `graph TD`, `sequenceDiagram`, …) on the fence's first
 * line — Mermaid requires that declaration to be the very first line, so the preamble cannot be
 * prepended before it without breaking every diagram it touches.
 */
export function injectClassDefs(markdown, preamble = mermaidClassDefPreamble()) {
  return String(markdown ?? '').replace(/(```mermaid\r?\n)([^\r\n]*\r?\n)/g, `$1$2${preamble}\n`);
}

function pngDataUri(pngPath) {
  return `data:image/png;base64,${readFileSync(pngPath).toString('base64')}`;
}

function themeTokens(dark) {
  const bg = dark ? '#15171B' : '#FAFAF8';
  const bgElevated = dark ? '#1C1F25' : '#FFFFFF';
  const fg = dark ? '#E8E9EC' : '#1A1B1E';
  const fgMuted = dark ? '#9AA1AD' : '#5B6270';
  const border = dark ? '#2B2F37' : '#E2E4E8';
  const codeBg = dark ? '#20232A' : '#F1F2F5';
  const navBg = dark ? '#1A1D22' : '#F3F4F6';
  const shadow = dark ? 'rgba(0,0,0,.4)' : 'rgba(20,22,30,.08)';
  const tags = dark
    ? { generatedBg: '#202A36', generatedFg: '#B9C6D6', writtenBg: '#1E2A1E', writtenFg: '#B9D6B9', gapBg: '#3A1E1E', gapFg: '#E6B3B3' }
    : { generatedBg: '#E7ECF3', generatedFg: '#33465E', writtenBg: '#EAF3EA', writtenFg: '#2E4A2E', gapBg: '#FBEAEA', gapFg: '#7A2020' };
  const kindBg = Object.entries(KIND_COLORS).map(([kind, hex]) => `--k-${kind}-bg: ${dark ? paleOnDark(hex) : paleOnLight(hex)};`).join(' ');
  return [
    `--bg: ${bg}; --bg-elevated: ${bgElevated}; --fg: ${fg}; --fg-muted: ${fgMuted}; --border: ${border};`,
    `--code-bg: ${codeBg}; --nav-bg: ${navBg}; --shadow: ${shadow};`,
    `--tag-generated-bg: ${tags.generatedBg}; --tag-generated-fg: ${tags.generatedFg};`,
    `--tag-written-bg: ${tags.writtenBg}; --tag-written-fg: ${tags.writtenFg};`,
    `--tag-gap-bg: ${tags.gapBg}; --tag-gap-fg: ${tags.gapFg};`,
    kindBg,
  ].join(' ');
}

function buildCss() {
  const kindAccents = Object.keys(KIND_COLORS).map(kind => `--k-${kind}: ${KIND_COLORS[kind]};`).join(' ');
  const dark = themeTokens(true);
  return `
:root {
  color-scheme: light dark;
  --accent: #2F5FA8;
  ${kindAccents}
  ${themeTokens(false)}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { ${dark} }
}
:root[data-theme="dark"] { ${dark} }

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg); color: var(--fg);
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  line-height: 1.55;
}
h1, h2, h3 { font-family: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif; font-weight: 600; line-height: 1.2; }
code, pre, .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
a { color: var(--accent); }
.shell { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 100vh; }
.tree { background: var(--nav-bg); border-right: 1px solid var(--border); padding: 20px 16px; position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto; }
.tree h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--fg-muted); margin: 18px 0 6px; }
.tree ul { list-style: none; margin: 0; padding: 0; }
.tree li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 13px; }
.tree a { text-decoration: none; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree a:hover { color: var(--accent); }
.tag { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; padding: 2px 6px; border-radius: 999px; flex: none; }
.tag.generated { background: var(--tag-generated-bg); color: var(--tag-generated-fg); }
.tag.written { background: var(--tag-written-bg); color: var(--tag-written-fg); }
.tag.gap { background: var(--tag-gap-bg); color: var(--tag-gap-fg); }
main { padding: 28px 40px 80px; min-width: 0; }
.masthead { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 20px; }
.masthead h1 { margin: 0; font-size: 26px; }
.masthead .meta { color: var(--fg-muted); font-size: 13px; margin: 0; }
#theme-toggle { background: var(--bg-elevated); border: 1px solid var(--border); color: var(--fg); border-radius: 8px; padding: 6px 10px; cursor: pointer; font: inherit; }
.legend-strip { list-style: none; display: flex; flex-wrap: wrap; gap: 10px 18px; margin: 16px 0 0; padding: 0; }
.legend-strip li { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-muted); }
.legend-strip .swatch { width: 12px; height: 12px; border-radius: 3px; background: var(--sw); flex: none; }
section.bundle-section { margin: 32px 0; }
section.bundle-section > h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--fg-muted); border-bottom: 1px solid var(--border); padding-bottom: 8px; }
figure { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin: 0 0 24px; box-shadow: 0 1px 2px var(--shadow); }
figure img { display: block; width: 100%; border-radius: 6px; }
figcaption { margin-top: 10px; font-size: 13px; color: var(--fg-muted); }
figcaption strong { color: var(--fg); }
article.doc { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; padding: 20px 24px; margin: 0 0 20px; box-shadow: 0 1px 2px var(--shadow); }
.doc-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.doc-head h3 { margin: 0; font-size: 16px; }
.doc-body pre { background: var(--code-bg); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
.doc-body pre.mermaid { background: var(--bg-elevated); text-align: center; }
.doc-body code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; }
.doc-body pre code { background: none; padding: 0; }
.doc-body table { border-collapse: collapse; width: 100%; font-size: 13px; }
.doc-body th, .doc-body td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
.empty { color: var(--fg-muted); font-style: italic; }
@media (max-width: 760px) {
  .shell { grid-template-columns: 1fr; }
  .tree { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--border); }
  main { padding: 20px 16px 60px; }
}
`.trim();
}

function legendStripHtml(legend) {
  if (!legend.length) return '';
  const items = legend.map(e => `<li style="--sw:${attr(e.colour)}"><span class="swatch"></span><span class="mono">${esc(e.kind)}</span><span>${esc(e.notation ?? '')}</span></li>`).join('');
  return `<ul class="legend-strip">${items}</ul>`;
}

function viewsSectionHtml(views) {
  if (!views.length) return '<section class="bundle-section" id="views"><h2>Views</h2><p class="empty">No rendered views.</p></section>';
  const figures = views.map(v => `
    <figure id="${attr(sanitizeId(`view-${v.id}`))}">
      <img src="${pngDataUri(v.pngPath)}" alt="${attr(v.title ?? v.id)}">
      <figcaption><strong>${esc(v.title ?? v.id)}</strong>${v.description ? ` — ${esc(v.description)}` : ''}</figcaption>
    </figure>`).join('');
  return `<section class="bundle-section" id="views"><h2>Views</h2>${figures}</section>`;
}

/** A doc's nav/section tag: 'gap' whenever its markdown carries a house-style GAP: marker,
 * regardless of which array it came from, else the group's own default. */
const tagFor = (item, defaultTag) => (/GAP:/.test(item.markdown ?? '') ? 'gap' : defaultTag);

function docsSectionHtml(id, title, items, defaultTag, preamble) {
  if (!items.length) return '';
  const articles = items.map(it => {
    const anchor = sanitizeId(`${id}-${it.path}`);
    const name = String(it.path).split('/').pop();
    const tag = tagFor(it, defaultTag);
    const md = scriptSafe(injectClassDefs(it.markdown ?? '', preamble));
    return `
    <article class="doc" id="${attr(anchor)}">
      <div class="doc-head"><h3>${esc(name)}</h3><span class="tag ${tag}">${tag}</span></div>
      <div class="doc-body" data-md-target></div>
      <script type="text/markdown">${md}</script>
    </article>`;
  }).join('');
  return `<section class="bundle-section" id="${id}"><h2>${esc(title)}</h2>${articles}</section>`;
}

function navGroupHtml(title, items, defaultTag, idPrefix) {
  if (!items.length) return '';
  const rows = items.map(it => {
    const anchor = sanitizeId(`${idPrefix}-${it.path}`);
    const tag = tagFor(it, defaultTag);
    return `<li><a href="#${attr(anchor)}">${esc(String(it.path).split('/').pop())}</a><span class="tag ${tag}">${tag}</span></li>`;
  }).join('');
  return `<div class="tree-group"><h2>${esc(title)}</h2><ul>${rows}</ul></div>`;
}

function navViewsHtml(views) {
  if (!views.length) return '';
  const rows = views.map(v => `<li><a href="#${attr(sanitizeId(`view-${v.id}`))}">${esc(v.title ?? v.id)}</a></li>`).join('');
  return `<div class="tree-group"><h2>Views</h2><ul>${rows}</ul></div>`;
}

// Everything the page does at runtime: wire the mermaid-aware marked renderer, expand every
// embedded doc's markdown into its target, typeset mermaid blocks, and run the theme toggle.
function clientScript() {
  return `
(function () {
  var escapeHtml = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var renderer = new marked.Renderer();
  var defaultCode = renderer.code.bind(renderer);
  renderer.code = function (code, infostring, escaped) {
    var lang = (infostring || '').trim().split(/\\s+/)[0];
    if (lang === 'mermaid') return '<pre class="mermaid">' + escapeHtml(code) + '</pre>';
    return defaultCode(code, infostring, escaped);
  };
  marked.use({ renderer: renderer });

  document.querySelectorAll('article.doc').forEach(function (article) {
    var src = article.querySelector('script[type="text/markdown"]');
    var target = article.querySelector('[data-md-target]');
    if (src && target) target.innerHTML = marked.parse(src.textContent);
  });

  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'strict' });
    // mermaid.run() can settle its returned promise as rejected even after it has already
    // painted every diagram to the DOM; catch it so that trailing rejection never surfaces as an
    // uncaught error for a page that otherwise rendered correctly.
    mermaid.run({ querySelector: '.mermaid' }).catch(function (err) { console.warn('mermaid: one or more diagrams may not have rendered', err); });
  }

  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    var stored = null;
    try { stored = localStorage.getItem('arch-bundle-theme'); } catch (e) { stored = null; }
    if (stored) document.documentElement.dataset.theme = stored;
    toggle.addEventListener('click', function () {
      var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('arch-bundle-theme', next); } catch (e) { /* per-viewer convenience only */ }
    });
  }

  var links = document.querySelectorAll('.tree a[href^="#"]');
  var sections = Array.prototype.map.call(links, function (a) { return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if (sections.length && 'IntersectionObserver' in window) {
    var byTarget = new Map();
    links.forEach(function (a, i) { if (sections[i]) byTarget.set(sections[i], a); });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = byTarget.get(entry.target);
        if (link) link.classList.toggle('active', entry.isIntersecting);
      });
    }, { rootMargin: '-10% 0px -80% 0px' });
    sections.forEach(function (s) { observer.observe(s); });
  }
})();
`.trim();
}

/**
 * bundleHtml({ views, written, generated, run, legend, meta }) -> a complete, self-contained HTML
 * document (string). views: [{id, title, description, pngPath}] — pngPath is read and embedded as
 * a base64 data: URI. written/generated/run: [{path, markdown}] — rendered client-side with marked;
 * any .c4/.json path is dropped (generated docs only, never hand-editable model/JSON sources).
 * legend: [{kind, colour, notation}] for the header strip. meta: {project, sha, generatedBy}.
 */
export function bundleHtml({ views = [], written = [], generated = [], run = [], legend = [], meta = {} } = {}) {
  const docWritten = written.filter(w => isDoc(w.path));
  const docGenerated = generated.filter(g => isDoc(g.path));
  const docRun = run.filter(r => isDoc(r.path));
  const preamble = mermaidClassDefPreamble();
  const project = meta.project ?? 'Architecture';
  const title = `${project} — architecture bundle`;

  const nav = [
    navViewsHtml(views),
    navGroupHtml('Written', docWritten, 'written', 'written'),
    navGroupHtml('Generated', docGenerated, 'generated', 'generated'),
    navGroupHtml('Run', docRun, 'written', 'run'),
  ].join('');

  const body = [
    viewsSectionHtml(views),
    docsSectionHtml('written', 'Written docs', docWritten, 'written', preamble),
    docsSectionHtml('generated', 'Generated docs', docGenerated, 'generated', preamble),
    docsSectionHtml('run', 'Run', docRun, 'written', preamble),
  ].join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${attr(FONTS_HREF)}">
<style>${buildCss()}</style>
</head>
<body>
<div class="shell">
  <nav class="tree" aria-label="Bundle contents">${nav}</nav>
  <main>
    <header class="masthead">
      <div>
        <h1>${esc(project)}</h1>
        <p class="meta">rev ${esc(meta.sha ?? 'unknown')} · generated by ${esc(meta.generatedBy ?? 'arch present-html')}</p>
      </div>
      <button id="theme-toggle" type="button" aria-label="Toggle light/dark theme">Theme</button>
    </header>
    ${legendStripHtml(legend)}
    ${body}
  </main>
</div>
<script src="${attr(MARKED_SRC)}"></script>
<script src="${attr(MERMAID_SRC)}"></script>
<script>${clientScript()}</script>
</body>
</html>
`;
}
