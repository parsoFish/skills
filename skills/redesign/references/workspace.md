# The workspace

Everything a fresh session needs to continue is in the workspace. The person's answers, the decisions and the state are committed; pages are rebuilt from their scripts.

```
<workspace>/
  CLAUDE.md          the project's rules: evidence sources, side effects of the old app, language and tone
  STATE.md           where the work stands, under 40 lines
  DECISIONS.md       the ledger, one row per decision
  PARKED.md          what waits for a later stage
  feedback/          <round>.json, written by the kit's server when Finish is pressed
  research/          studies and spikes
  reviews/           <round>/build.mjs committed; index.html, _shots/, feedback.json and .server.json ignored
  PRD.md ARCHITECTURE.md specs/ wireframes/ PLAN.md handoff/     one track
  <track>/PRD.md …                                                 several tracks
```

`round.mjs new` writes `reviews/.gitignore` with the ignore rules. Commit after every round: the answers, the decisions, the changed documents and `STATE.md` together. When the workspace is its own repository, work on a branch per stage; tag each lock `stage-<n>-locked` either way.

## STATE.md

Fixed shape, under 40 lines. Facts about the machine or the shell go to `CLAUDE.md`; defects in the kit go to the kit, not here.

```markdown
# State

| Stage | core | console |
|---|---|---|
| 1 PRD | locked 2026-03-05 (63) | locked 2026-03-05 (63) |
| 2 Architecture and specs | round 02-arch-2 | agreed, awaiting lock |
| 3 Wireframes | with stage 2 | skipped (71) |
| 4 Mock | | |
| 5 Plan and hand-off | | |

## Waiting on
Round `02-arch-2` at http://127.0.0.1:7800/02-arch-2/, opened 2026-03-06 09:12, the person told at 09:13.

## Next
1. `round.mjs answers 02-arch-2`, decide from 101.
2. Update ARCHITECTURE.md; if agreed, open 02-billing-1 (teardown rows from research/as-built.md).

## Standing word
- 67: align the mock's lists to what the product's tooling lists, without a round.

## Outside the workspace, the person's
- The scratch repository from the API spike is theirs to delete (97).
```

## DECISIONS.md

```markdown
| # | Date | Kind | Track | Decision | Source |
|---|---|---|---|---|---|
| 12 | 2026-03-05 | product | console | Search is one box that routes by what is typed; no mode switch. "I never want to pick a kind first." | 01-prd-1 q.search |
| 13 | 2026-03-05 | architecture | console | One process serves the page and the API; the worker that talks to devices is separate (replaces 9). | 02-arch-1 a.shape |
| 14 | 2026-03-06 | standing | console | Lists in the mock name what the tooling actually offers; aligned without a round (scope: names and values in mock lists). | 04-look-2 extra |
```

- Append with `round.mjs decide`; it numbers from the highest row. Never renumber. Track is `-` when there is one track.
- Kinds: `product`, `process` (how the redesign itself runs), `architecture` (a structural choice; the text or a linked record carries context, options and consequences), `standing` (a delegated class of decisions with its scope).
- A change of mind is a new row ending `(replaces N)`. A row that settles something an earlier row left open ends `(settles N)`.
- Quote the person verbatim where a quote carries the reason. Source is `<round> <askId>`, `chat`, or `spike <name>`.
- Decisions taken against your recommendation are marked so in the text: re-read them before recommending again.

## PARKED.md

A table: waits for (a stage number, "later", "not this redesign", or "after the build" for notes about the process itself), track, what, where it came from. When a parked item is taken up, change its first column to `taken up` and name the decision.

## feedback/

The person's answers as they gave them, one file per round, written by the server the moment Finish is pressed. Each file carries the questions, options and defaults it answered (`reference`), so it reads without its page. Never edit one.

## research/

One file per study or spike, with five headings in this order: **What it set out to settle**, **What happened**, **What it means**, **Not verified**, **Left behind**. The "Not verified" lists feed the lock page's unproven list.

- Tell the person before a spike, with its cost and what it will create; a subagent's request is not their approval.
- A study of a running system reads source and documents only, never its data, keys or secrets, and a subagent sent to study is told so in its first lines.
- Scratch lives outside the workspace and is deleted when the spike is written up. Name what you delete before you delete it.
