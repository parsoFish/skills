# The stages in detail

What each stage produces. Round ids use the stage number: `01-prd-1`, `02-arch-1`, `02-billing-2`, `04-look-3`, `05-lock-1`.

## Stage 1: PRD

Produces one `PRD.md` per track. Sections in order: the problem; who uses it and for what; goals and measures; user stories; requirements; constraints; non-goals. A sentence that would stop being true under a different interface or codebase belongs to a later stage.

Stories and requirements follow the grammar in [kit.md](kit.md) (stories `S-01`, requirements `R-01`); run `node <skill-dir>/scripts/prd.mjs check PRD.md` before every page that shows a PRD and in the PRD round's build script.

Round shape that worked: round one is the teardown of what exists (rows per screen and feature, defaulted to your proposal) plus the framing questions; round two reads the stories back; round three is the requirements; the lock is a diff. Four rounds covered an application of 80 stories. Ask the framing questions about the person's own way of working open, with no recommendation.

## Stage 2: architecture, then feature specs

### Architecture first

Produces `ARCHITECTURE.md` (per track) and architecture decision records in `DECISIONS.md` with kind `architecture`. Treat it like the look rounds: draw two or three structurally different shapes of the proposed system, let the person pick a direction, then go deep on that one.

Each round draws, never tables:

- **Context**: the system, the people and the other systems it talks to.
- **Containers**: the runnable parts, what each stores, how they talk.
- **Data flow** for the two or three stories that matter most.
- **Reach**: where each part runs, which address and port it answers on, which client reaches it from where. This matrix was the single biggest source of surprises at the end of the first build.
- **Seams** between tracks: what one track exposes and the other consumes.

Each structural choice is a question on the page with a recommendation, and becomes a decision record: context, options considered, decision, consequences, and what it replaces. The stack (language, runtime, storage, UI framework) is one of these questions. Never leave it as your call without comment: when that happened, the person noticed only after the build.

If a skill for drawing and documenting architecture is available in the person's environment, use it to draw and keep the records; otherwise draw with the kit's `figure` helper and keep the records in the ledger.

### Feature specs

Produces one `specs/<area>.md` per feature area (the areas and their order are a decision). Each spec: behaviour, data, interfaces, errors, and a numbered test list the build will implement one for one. Write every test so a build can check it on more than one platform: a capability that depends on the kind of machine or shell gets one test row per kind.

The round shape that agreed seven areas in seven short rounds is in [review-pages.md](review-pages.md).

Resolve ambiguous nouns before the lock: what the release branch means (local, remote, who moves it), what "the new system" means while the old one runs, who starts each unit of work when the build is autonomous. Each unresolved noun becomes a question at the end of the build.

## Stage 3: wireframes

Drawn beside the specs, in the same rounds. Greyscale, real labels, unfinished on purpose, desktop and phone side by side (`render.pair`). Two or three structurally different directions in the first round; one direction thereafter. Keep them as markup in files the page imports, so a wireframe and its spec cannot drift.

## Stage 4: mocked MVP

### The look

Options that differ only in colour are one option. Give each idea its own parts (its own controls, charts, items, type), or the person reads them as templated. The order that worked, one round each: direction (three or four identities on the locked frames), the idea (the chosen direction three ways), strength (how far to push it), palette, controls in every state, charts and meters, items and type, whole screens at true size. Each round is a few drawings and two to four questions, under three thousand words.

A look round's drawings are kept as the record of how the look was reached; once a choice is settled, remove the ways not chosen from the files the mock is built from, but leave the round's own files alone so its page still builds.

### The mock

The stories made clickable with deep functionality acted out, to settle behaviour by using it. Use the product's real names and values, read from its own tooling, never invented ones. Two rounds was enough for 42 must stories:

1. Build the core (routing, store, fixtures) and a short written contract for an area: which files it owns, which hooks of the core it may use, how it registers its screens. Build the first area yourself. The page is a link to the mock and a row per story to mark "works at both sizes".
2. Fan the remaining areas out to subagents, one area each in its own files with its own tests, then a second pass that joins them where one area's screen refers to another's. Before the page, grep for duplicate handler or route names across areas, and run the test suite once, not per agent in parallel. One combined page with a tab per area and a row per story; do not promise per-agent feedback.

Walk the mock yourself at both sizes before the page opens, and say on the page what nobody checked.

## Stage 5: build plan and hand-off

Produces `PLAN.md` per track and the hand-off packet of [handoff.md](handoff.md). The plan: the order of the build in chunks or steps, what each proves, the tests from the specs each step owns, what moves over from the deployed system and when, and "the end": the acts that switch from old to new, with the person's acts separated from the build's.

Draw the plan as lanes over time on the page; read the counts from the documents and fail the build if they disagree. Both plans for two tracks fit one drawing.

The stage-5 lock page is described in [handoff.md](handoff.md). Planning ends when the packet has been dry-run against the real target.
