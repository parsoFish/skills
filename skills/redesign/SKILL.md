---
name: redesign
description: Plans the redesign or rebuild of an existing application in reviewed stages, treating what exists as a proof of concept, with the person deciding each stage on a local HTML review page. Use when the user asks to redesign, rebuild, rethink, re-plan or start over on an existing app, dashboard, service or system, to continue such a redesign, or says they have finished reviewing a page of a redesign in progress.
license: MIT
---

# Redesign

Take an application that already exists as evidence of what is wanted, not as the template, and design its replacement from the smallest seed upward. The person decides. You find the evidence, propose, draw, and write down what was decided.

This skill fixes three things: the order of the stages, how a review round works, and what the workspace keeps. Everything else is your judgement for the application in front of you: how to read it, how many rounds a stage needs, what a page shows. Fewer, lighter, faster rounds keep the person engaged; a thorough page they skim teaches you nothing.

`<skill-dir>` below is the folder this file was loaded from; the kit is `<skill-dir>/scripts/`.

## 1. Open the workspace

1. Work in the workspace the person names: its own repository, or a folder inside the app's. If `STATE.md` exists, read it and continue from its "Next" section. Otherwise create `STATE.md`, `DECISIONS.md` and `PARKED.md` as [references/workspace.md](references/workspace.md) lays them out.
2. Settle three things without stopping to ask: the language and tone of the documents (match the application's own docs); where the evidence of the existing application is (the checkout and docs in front of you; a running instance only when the person offers one); what you may do to the existing application (nothing with side effects, such as runs that count, probe or cost, until the person says). Write them into the workspace's `CLAUDE.md` (append if one exists) as assumptions, record them as the first decisions, and name them in the message that hands over the first page, so the person corrects them there rather than answering questions before seeing anything.
3. Decide the tracks. Parts that will be built independently get their own documents under `<track>/`; one track keeps its documents at the workspace root. Say which track comes first. Record it as a decision.
4. Scaffold the first round: `node <skill-dir>/scripts/round.mjs new 01-prd-1`. It also writes the ignore rules for generated pages. [references/kit.md](references/kit.md) lists every command.

## 2. Work the stages in order

| # | Stage | Produces | Locks when |
|---|---|---|---|
| 1 | PRD | the problem, who uses it, goals, stories with a done-when each, requirements with given/when/then, constraints, non-goals; no interface, stack or architecture | the person locks it on a page |
| 2 | Architecture, then feature specs | first: drawings of the proposed system (context, containers, data flow, reach), the stack and the seams between tracks, each put to the person as a question with a decision record; then one spec per feature area: behaviour, data, interfaces, errors, tests | each area agreed, then one lock with stage 3 |
| 3 | Wireframes | drawn in the same rounds as the specs: existing screens picked apart as keep, rework, merge or drop, pages consolidated under logical groupings, desktop and phone | with stage 2 |
| 4 | Mocked MVP | the look, then the stories made clickable with deep functionality mocked, judged by using it | the whole mock walked |
| 5 | Build plan and hand-off | the order of the build, how what is deployed moves over, and the hand-off packet of [references/handoff.md](references/handoff.md) | the packet has been dry-run |

- Open a stage only when the person has locked the one before; stages 2 and 3 run together and lock together. Write down what comes up early in `PARKED.md`; do not act on it. A track may skip a stage it has no use for: say so as a decision. Record a lock in `STATE.md` with its decision number and tag the commit `stage-<n>-locked`.
- Architecture is iterated the way a look is: two or three structurally different drawings a round, a direction chosen, then depth. The stack is never your call left uncommented.
- When a spec rests on something only documented, run a spike: tell the person first, keep it small and outside the workspace, write it up in `research/` with the five headings in [references/workspace.md](references/workspace.md), delete the scratch.
- [references/stages.md](references/stages.md) has what each stage produces in detail, including the look rounds and the mock fan-out.

## 3. Run a round

1. Read `DECISIONS.md` and `PARKED.md` before writing a question. Anything settled is shown as settled on the page, never asked again.
2. Build the page as [references/review-pages.md](references/review-pages.md) says: it opens on the picture and the question; prose is one sentence per option; documents are linked or folded, never rendered whole; rows carry your recommendation as their default so the person touches only exceptions; permissions and actions in the world are a checklist block, not a choice; the page has one "anything else" box.
3. Run `node <skill-dir>/scripts/round.mjs build <round>`, then `round.mjs open <round> --no-browser` to start the server, then `node <skill-dir>/scripts/check.mjs <round> --devices desktop,phone`. If a shot reports overflow, narrow the widest element it names (a table, a figure, a long unbroken string), rebuild and check again. Then `round.mjs open <round>`.
4. Tell the person the address in one short message. Start `round.mjs wait <round>` in the background and end your turn. Pressing Finish on the page ends the wait. If the person says in chat that they are done instead, treat that as the release and read the answers. If the wait times out, say so and wait again; do not build the next round.
5. When released, run `round.mjs answers <round>`, turn the answers into rows with `round.mjs decide` (their words verbatim where you quote them; a change of mind is a new row that names the one it replaces), update the documents, update `STATE.md`, commit. Then run another round or ask for the lock.
6. A lock page is a diff and a checklist: what changed since the last agreed draft, what is unproven, risks, one row per document to lock. It never shows the documents again.

## 4. Pace, away mode, standing word

- **Pace.** Once answers run "as proposed", make rounds larger and fewer. Offer "no stops" explicitly, with its cost named. When a question is about how the person works rather than about the product, ask it open, without a recommendation.
- **Away mode.** When the person says they are leaving, finish what is lined up inside the locked boundaries, batch the remaining rounds into one page, write the "Next" section of `STATE.md` so a fresh session continues without them, and send no message until there is news.
- **Standing word.** When the person delegates a class of decisions ("align the lists to what exists without coming back"), record a `standing` decision with its scope, apply it without a round, and record each use as a product decision whose source names the standing one.
- **Continuations.** After a context reset, read `STATE.md` first. Its "Waiting on" line says whether the person already has a page and whether you have told them. Do not send a message that says nothing has changed.

## When not to use

- A new application with nothing to pick apart: ordinary planning and brainstorming.
- Building the application: planning ends at the hand-off packet, and the build follows the plan in its own repository with its own loop.
- A change to one feature of an application nobody is rebuilding.
- The person does not want a review gate between stages.
