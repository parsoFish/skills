# The kit

`scripts/` beside the skill builds, serves, checks and records review rounds. It needs Node 22 and nothing else, and never touches the network. Run every command as `node <skill-dir>/scripts/<tool>.mjs …` from the workspace, or pass `--workspace <dir>`. Every command answers `--help`.

## round.mjs: the round's mechanics

```
node round.mjs new <round> [--title "..."] [--stage N]
node round.mjs build <round>
node round.mjs open <round> [--no-browser]
node round.mjs wait <round> [--timeout <seconds>] [--every <seconds>]
node round.mjs answers <round> [--json]
node round.mjs decide [--file <decisions.json>] [--date YYYY-MM-DD]
node round.mjs status [--json]
```

- A round id is `<two-digit stage>-<name>-<number>`: `01-prd-1`, `02-arch-2`, `05-lock-1`.
- `new` writes `reviews/<round>/build.mjs` from a template (a page with one figure, one ask, the "anything else" box and a computed counts line) and records the kit's location in `reviews/.kit`. It refuses an existing round.
- `build` runs the round's script with `REDESIGN_KIT` set and prints `<round>: N asks, N items, N figures`. A script that throws (a failed `toYou`, a count that disagrees with the documents) fails the build.
- `open` reuses a healthy server from `reviews/.server.json` or starts one detached, then opens `http://127.0.0.1:<port>/<round>/` with the platform's opener and always prints the address.
- `wait` polls the round's live feedback until `submitted: true`, prints the answers and exits 0; exits 2 on timeout (default 3600 s). Run it in the background so you are woken when the person presses Finish.
- `answers` reads `feedback/<round>.json` (or the live file) and prints, per ask: the question, the chosen label, whether it matched the recommendation, the note; items off their default; comments; the "anything else" text; required asks left unanswered.
- `decide` reads a JSON array `[{ text, kind, track, source, replaces?, scope? }]` from stdin or `--file`, validates `kind` (`product | process | architecture | standing`), appends rows to `DECISIONS.md` numbered from the highest present (creating the header if absent), and prints the new numbers. Pipes in text are escaped; newlines become spaces.
- `status` prints the server's state, the last round and whether it is submitted, the highest decision number, and the first heading of `STATE.md`.

## serve.mjs: the review server

```
node serve.mjs [--port 7800] [--dir reviews] [--workspace <dir>] [--detach]
```

Loopback only. If the port is busy it takes the next free one (`REDESIGN_PORT` sets the default), prints `review server: http://127.0.0.1:<port>/` and writes `reviews/.server.json`. `--detach` re-spawns itself and returns once the child answers `/health`.

Routes: `/` lists the rounds, newest first; `/health`; `/kit/review.js` and `/kit/review.css` from `assets/`; `GET` and `PUT /api/feedback/<round>`; files under `reviews/` with an allowed extension (`build.mjs` and the feedback files are never served). A `PUT` needs the server's own `Origin` and `application/json`, is capped at 2 MiB, and is written atomically with a `feedback.prev.json` kept. When a `PUT` carries `submitted: true`, the answers are also written to `<workspace>/feedback/<round>.json`, the file you commit.

## check.mjs: shots and overflow

```
node check.mjs <url-or-round> [--devices desktop,phone] [--out <dir>] [--full] [--click <selector>]... [--wait <ms>] [--browser <path>]
```

A round id resolves through `reviews/.server.json`, so start the server first (`round.mjs open <round> --no-browser`); a URL works without one. Finds a browser (`--browser`, then `REDESIGN_BROWSER`, then Chromium, Chrome, Edge or Brave on the PATH and in the usual install folders), drives it headless over the DevTools protocol, and shoots each device: `desktop` 1440×900, `desktop-tall` 1440×2800, `phone` 412×915 at 2×, `phone-small` 360×740 at 2×. Phones are emulated for real: mobile viewport, device scale, touch, a mobile user agent. A narrow desktop window is not a phone and is not offered.

Each shot is checked for horizontal overflow against the device width and reported with its path and verdict; any overflow exits 1. `--full` captures the whole page; `--click` performs clicks in order before shooting (to open a tab or press a control). Shots land in `reviews/<round>/_shots/<device>.png`, which the workspace ignores.

## prd.mjs: the one deterministic gate

```
node prd.mjs check <file>...
node prd.mjs counts <file>
```

Parses the story and requirement grammar below and fails on: a story with no `Done when`; a `must` or `should` story no requirement serves; a requirement serving a missing story or with no given/when/then; a repeated id; an id-shaped bullet that breaks the grammar. Run it before every page that shows a PRD and in the PRD round's build script.

```
Ids match /^[A-Z][A-Z0-9]*-\d+$/. Stories are S-01, S-02 …; requirements are R-01, R-02 …
(a prefix per track, such as CS-01 and CR-01, when two tracks share a page). Each id is used once.

A story, one list item, with its fields indented two spaces beneath it:
  - **S-01** `must` As an operator I want one place to say what I want done.
    Done when: there is one place, and nothing asks me to pick a kind first.
    From: where the story came from (optional)
    Changed: what changed since the last version (optional)
  The tier is `must`, `should` or `later`. A ⇄ after the tier marks a story whose other side lives in a companion document.

A requirement, one list item, with its acceptance lines indented beneath it:
  - **R-01** What must hold. *Serves S-01, S-04.*
    - Given a situation, when something happens, then this is the outcome.
```

`parsePrd(markdown)` returns `{ sections, stories, requirements, malformed }`; `checkPrd(prd)` returns the problems; `storiesOf` and `requirementsOf` filter by section for page builders.

## render.mjs and blocks.mjs: the page

A build script imports these from the kit directory (`REDESIGN_KIT`, or the path in `reviews/.kit`) and writes `index.html`. Every function returns a string and mutates nothing.

`render.mjs`:

- `page({ round, stage, title, lede, tabs: [{ id, title, html }], lang = 'en', extraBox = true })`: the document. `extraBox` is the page's one "anything else" box.
- `ask({ id, kind: 'choice' | 'multi' | 'text', q, why, options: [{ value, label, detail, rec }], proposal, optional, settled })`: a question. `settled: { decision, text }` shows the decision instead of options.
- `items({ scale: [{ value, label }], fallback, setAll, rows: [{ id, key, name, desc, bodyHtml, chip, fallback, withdrawn }] })`: rows the person marks; a row starts on its default so they touch only exceptions. Scale labels may not contain `,` or `:`.
- `comment(id)`: a comment box on any block.
- `figure({ html, css, caption, alt })`: a drawing in its own shadow root, so the page's stylesheet cannot reach it and its styles cannot leak out.
- `shot({ src, alt, caption, width })`: an image with alt text and a link to the full size.
- `pair({ left, right, labels, caption })`: two figures or shots side by side (desktop and phone, before and after); they stack on a narrow screen.
- `counts(html)`: `{ asks, items, figures }` read from the markup, for the closing log line.

`blocks.mjs`:

- `md(markdown, { headingBase = 2 })`: HTML for a markdown subset (headings, nested lists that continue after a table, tables, fences, blockquotes, inline code, bold, italic, links with safe schemes). `#` becomes `h2` by default so a document sits under the page's title.
- `sections(markdown)`: `[{ level, title, slug, body }]`.
- `parseDecisions(decisionsMd)`: `[{ n, date, kind, track, text, source, replaces }]`, reading both the current and the earlier row format.
- `docTab({ id, title, markdown, comments = true })`: a document as one block per `##` section with a comment box each.
- `folded(title, html, open = false)`: a `<details>` fold.
- `teardown({ rows: [{ id, name, verdict, what, goes }], scale })`: existing screens as rows defaulting to your verdict (keep, rework, merge, drop).
- `sinceTab({ decisionsMd, rounds, title })`: the ledger rows whose source names the given rounds, as "what your answers became".
- `lockPage({ documents: [{ name, path, changedSince, link }], unproven, risks, ask })`: the lock page body; never a whole document.
- `toYou(text, pairs)`: third person to second person, with `pairs` as `[['the operator adds', 'you add'], ['the operator', 'you']]`; throws naming the first `from` phrase that survives, so a page cannot ship naming the person.

Kit classes are prefixed `rv-`, element styles are scoped to the page, fonts are system fonts, and nothing loads from the network. `page` throws on a duplicate tab, ask, row or comment id, because answers are stored by id; `figure` and `shot` need alt text; a `lockPage` line over 400 characters throws, so a document cannot be pasted in as "what changed". Ids the kit uses itself, which a page must not reuse: `sec.since`, `sec.lock.*`, `doc.*` and the ask `lock`.

`figure` relies on declarative shadow DOM (Chromium 111, Safari 16.4, Firefox 123 or later); an older browser shows the caption and alt text only.

## The feedback file

```
{ round, title, savedAt, submitted, submittedAt, savedTo,
  asks: { [id]: { value, note, accepted } },
  items: { [id]: { value, note } },
  comments: { [id]: text },
  extra: text,
  reference: { asks: { [id]: { question, kind, options, recommended, optional, settled } },
               items: { [id]: { name, default } } } }
```

`reference` makes the file read without its page. Never edit one by hand.
