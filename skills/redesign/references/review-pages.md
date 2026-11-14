# Review pages

A page exists to get a decision, not to be read. People skim: in the first full run of these stages, nine rows in ten were left on their default and the heaviest pages were submitted in under four minutes. Build for the skim.

## Shape

1. **Open on the picture and the question.** The first thing in a tab is the drawing, screenshot, mock link or wireframe, and the ask it supports. Prose comes after, one sentence per option. Rationale longer than that goes behind `folded`.
2. **Never render a document whole.** Link it, or fold it section by section with a comment box per section (`docTab`). A lock page shows what changed since the last agreed draft, not the draft.
3. **Draw what has shape.** Anything with topology (architecture, flow, sequence, state), geometry (screens), time (lanes of a plan) or more than three dimensions of comparison is a `figure`, `pair` or `shot`. A figure is HTML and CSS of your own, or inline SVG, inside its own shadow root; give it real labels and keep it to one idea. Tables are for lists the person marks, not for things they must understand.
4. **Budget.** Aim under 3,000 words of visible text per page. A spec round that needs more is two rounds.
5. **Recommend and default.** Every product choice carries a recommendation; every row starts on your verdict. The person touches only exceptions. Say so in the lede. The two exceptions: a question about how the person works, and the lock ask, which carry no recommendation.
6. **Settled is shown, not asked.** Read `DECISIONS.md` before writing a question. Something the person has decided appears with `ask({ settled: { decision, text } })`. Re-asking a settled thing is the one complaint people write on the page about the page.
7. **Actions in the world are a checklist, not a choice.** Permission to create a repository, a secret to place, a file to delete: a block of checkboxes the person ticks when done, with your read of their state. Not an option list.
8. **One "anything else" box per page.** The page's own `extraBox`, at the Finish button. This is where the most useful process notes arrive; per-tab "how did this feel" boxes go unanswered.
9. **Counts and links are computed.** Use `counts` for the log line and read numbers from the documents; never type them.
10. **Check before you open.** `check.mjs <round> --devices desktop,phone` shoots the page under real phone emulation and fails on horizontal overflow. A headless browser at a narrow window size is not a phone.

## Asks

- `choice` with a `rec` option for product questions; `multi` rarely; `text` only when no option could hold the answer, and optional.
- When a note contradicts the chosen option, treat the note as the answer and say so in the decision row.
- Say what the page does not cover: what nobody checked, what is acted out, what waits for the build.

## Lock pages

Lock pages are ceremonies; the person has already decided. `lockPage` builds the shape: what changed in each document since the last agreed draft (lines, not documents); what is unproven, folded, each row with an owner; the risks you see; one row per document, Lock or Not yet; the lock ask with no recommendation, so that "accept the rest" cannot lock the stage.

## Round shapes that worked

- A spec area: tabs **Since last time** (`sinceTab`), **Today** (the existing screens as `teardown` rows with screenshots), **Wireframes** (`pair` per screen), **Questions**, **Spec** (`docTab`, the previous area folded for agreement).
- A look round: the settled parts so far, one to three tabs of structurally different drawings, two to four questions.
- A mock round: a link to the mock and a row per story to mark "works at both sizes".
- A plan lock: the plan drawn as lanes over time, then the lock shape above.

## Styles

Drawings go inside `figure`, which isolates them from the page's stylesheet with a shadow root: nothing leaks in or out, so give each figure its own small stylesheet. Fonts are system fonts; a page never loads anything from the network.
