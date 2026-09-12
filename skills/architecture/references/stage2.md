# Stage 2 in detail: budget, the brief, and doc-set proportionality

## Why `_run/brief.md` exists

A measured run on a ~78-file TypeScript service (no `--out`, sonnet, headless) needed 260 turns
against a stated budget of 60 — a first attempt hit a 90-turn cap with no review or interview
written at all. Where the turns went: roughly 25 calls reading or grepping this skill's own
`scripts/arch/*.mjs` to learn what a failing rule wanted (the rules and their fixes were not
stated anywhere agent-facing); 8 back-to-back reads of every `references/*.md` plus several
`cat`s of the generated JSON, because SKILL.md pointed at five JSON files and the checklist
separately with no single digest for stage 2; 7 full `arch run` re-executions (each re-extracts
and re-renders PNGs) used as a "did my edit fix the rule" probe, including six *after* `guard
close`; rewrite loops on the same files (`hand.c4` four times, `glossary.md` four times,
`overview.md` four times, `stakeholders.md` written twice in a row); and ~10 calls in stage 0
studying `model.mjs`/`walk.mjs` just to work out the `fold-rules.json` schema.

`_run/brief.md` (built by `brief.mjs`, written by `arch run`) is the fix: stage 1 already knows
every fact stage 2 spent turns rediscovering — which views are required and where, which fitness
and completeness checks are failing and exactly what to do about each, the seeded model edges, the
gap list. Putting all of it in one file, in the order stage 2 acts on it, removes the reason to
read the kit's source or re-run the kit as a probe. `classify --help-fold-rules` (stage 0) closes
the other gap the same way, for the one artefact stage 1 cannot yet have produced (`arch classify . --help-fold-rules`).

## The 120-turn budget

60 turns was the stated budget before this was measured; the run above needed 260 for a
service-shaped repo of ~78 files, mostly turns spent reading source that a brief now supplies
directly. 120 turns is the revised budget for that shape and size: room for one `Write` per
required document (a service kind typically requires 10-14 written files plus `hand.c4`), the two
`arch run --no-render` revalidation passes item 4 of the SKILL.md steps allows, `guard verify`,
`guard close`, and the final rendering run — without room for rewrite loops, source-reading
detours, or re-running the kit as a print statement. A smaller or simpler repo (below) needs a
smaller fraction of that; a repo with materially more than ~100 source files, or a monorepo
classified into several kinds at once, is out of this budget's evidence and should be split into
one review per kind or component rather than stretched.

## Doc-set proportionality

The full service-kind set (overview, quality, ≥2 scenarios, journeys, signals, secrets, risks,
stakeholders, glossary, deps whys, plus loop/device-topology/job-dag/data-contracts when the kind
calls for them) is the *ceiling*, not the default. Scale down from it:

| project shape | scenarios | journeys | ADRs | rationale |
|---|---|---|---|---|
| under ~100 source files, any kind | ≤ 2 | only if `reference/ui.json` shows a real UI | only decisions evidenced in code or an existing doc | a small repo has fewer real scenarios and no UI to map — writing more invents content, it does not describe it |
| ~100+ source files, service/iac/pipeline kind | per house-style §3 minimum (2 for service) | per checklist | as above | the full required set from `references/house-style.md`, still evidence-only for ADRs |
| a kind whose `CHECKLIST.md` row reads `n/a` or `n/a: optional for this kind` | skip that view entirely | skip | skip | `CHECKLIST.md`'s own required-view matrix is the source of truth per kind — never write a view marked not-applicable "to be thorough" |

The run that produced the evidence above invented three ADRs with no cited decision behind them —
exactly the failure mode this table exists to stop. When a real decision is evidenced but nobody
has ruled on the alternative, that is a `human`-class gap: ask about it in the interview, do not
write an ADR to fill the checklist row.

## The command sequence, and why it is fixed

`_run/brief.md` §8 states the exact command list; `arch.mjs run()` is the only place stage 1
recomputes fitness/completeness/checklist state, so every "did that fix it" question stage 2 has
is answered by re-running it — but rendering (LikeC4 → PNG) is the slow part of that command, not
extraction, which is why the fast revalidation loop passes `--no-render` and rendering happens
exactly once, at the very end, after `guard close`. Running `arch run` (with or without render)
*after* `guard close` is a defect, not a normal regeneration pass: `guard close` marks the review
finished, and every file it protects (`reference/`, `CHECKLIST.md`, the generated model, `gaps.json`,
`questions.md`) is meant to reflect the reviewed state exactly once, not be regenerated again by a
stage that has already signed off.

## Exit checklist (expands SKILL.md stage 2 step 7)

- `arch guard verify` passed on the *first* try after the revalidation passes in step 4 — a second
  `guard verify` failure means step 4 was skipped or a kit-owned file was touched; fix that, do not
  retry `guard verify` speculatively.
- `arch check` passes, or every remaining failure is a real project/kit gap named in `review.md` or
  `kit-issues.md` (see `_run/brief.md` §3 for the recipe that produced each fix or each gap).
- Every written file is under 400 lines; net lines added/removed is reported in the final message.
- Every gap the brief listed is classified exactly once (kit, project, or human) — never left
  unclassified, never classified twice under two different ids.
- Every interview question is an operator decision, not something the kit already knows the
  answer to — `guard verify` enforces this mechanically, but a question that merely *reads* like an
  operator question while actually asking about an extractor's behaviour still belongs in
  `kit-issues.md`.
