# Changelog

All notable changes to this repo. Conventional commits drive entries; one line per skill change.

## Unreleased
- fix(gate): a raw eval result is stamped with the digest of the skill content it ran against and reused only for that content; a failed result forces a fresh run instead of being reused.
- fix(gate): eval reuse reads the last attested report from `HEAD` when a quick gate has overwritten the working-tree copy, so `gate:quick` before a full run no longer re-buys every case.
- feat(gate): `--reuse-evals` reuses a case whenever its own skill's content digest matches the last attested report, so a squash merge or an unrelated skill change no longer re-buys it.

## 0.2.2 — 2026-09-17
- fix(architecture): the deps extractor scans `.jsx`, `.cjs`, `.mts` and `.cts` files and recognises side-effect and dynamic `import()` specifiers, so `react-dom/client` in a `.jsx` file and a lazily-loaded package no longer read as unused (#4, #14).
- fix(architecture): `arch run` inside an open stage-2 review refreshes the guard snapshot, and `guard close` applies the same check as `guard verify`, so a sanctioned revalidation is never reported as tampering and the two commands cannot disagree (#15).
- feat(architecture): `answers.json` accepts `"answer": "n/a"` (or `notApplicable: true`) for any gap; the gap stays in `gaps.json` as `accepted` and is never re-raised in questions, project-changes or kit-issues (#3).
- feat(architecture): `arch extract jobs` catalogues Makefile targets, job-named npm scripts, Kubernetes CronJobs, workflow `schedule` triggers and in-process `cron.schedule` calls into `reference/jobs.md`; the job-dag checklist row now points at it (#2).
- feat(architecture): the legend declares `deploymentNode` kinds (environment, zone, node, device) so a hand-written `deployment { }` block and `deployment view deployment` in hand.c4 validate and render to `reference/views/deployment.png`, which satisfies the deployment checklist row (#1).
- fix(attest): judge the attested commit's ancestry only when a ref still reaches it, so a squash-merged branch's dangling tip no longer fails `npm run attest` on the maintainer's clone (#13).
- fix(gate): run every claude child with the auto-updater disabled and fail with a named HARNESS reason when the CLI version changes mid-run (#16).

## 0.2.1 — 2026-09-13
- docs(architecture): `references/house-style.md` states it is the specification of record.
- refactor(skill-dev): terse imperative body (81 lines) with the per-step rationale moved to `references/rationale.md`.
- docs: record the 2026-09-13 policy decisions in CLAUDE.md (dormant optional CI job, accepted gate thresholds, exact tool pins).

## 0.2.0 — 2026-09-12
- fix(gate): detect harness-only and no-upstream changes instead of silently no-oping, and stop treating a skipped agentic phase as a pass.
- feat(attest): content-hash attestation over git blob SHAs, verified by CI independently of the local run that produced it.
- feat(report): generate a human-readable `evals/REPORT.md` from the gate report and per-case evidence.
- feat(release): `scripts/release.mjs` bumps every manifest and rolls the CHANGELOG; `release.yml` tags and publishes a GitHub release on push to main.
- feat(protect-main): idempotent branch-protection + repo-settings script, with `--dry-run` and `--check`.
- feat(skills): publish `skill-dev` and `eval-authoring`; add project-local ops skills for gate runs, release and critical review.
- chore(lint): guard against network-touching fixtures, oversized skills, and SKILL.md claiming a flag the kit doesn't accept.
- fix(architecture): remove the raw NUL byte in `extract-terraform.mjs` so the file diffs as text.
- docs: add `docs/gate-runbook.md`, a remedy per gate step and per attestation-verify failure reason.
- docs: rewrite CLAUDE.md, README.md and CONTRIBUTING.md to match what the gate, release and protection scripts actually do.
- feat(architecture): stage 1 writes `_run/brief.md` (rules, fix recipes, required views, seeded edges, allowed commands) so stage 2 reads one file; `classify --help-fold-rules`; stage-2 budget 120 turns with doc-set proportionality; no edits after `guard close`.
- fix(evals): the drift case judges `docs/reference/drift.md` for the specific undeclared edge instead of a regex the prompt itself satisfies; static guards for prompt-echo regexes, unscored cases and network-touching fixtures.
- fix(architecture): flow.md describes the real engines; the ghost `--github` option is gone; the HTML bundle is self-contained offline; tool versions pinned in `tools.json`.

## 0.1.0 — 2026-09-12
- feat(architecture): scaffold the architecture skill with its deterministic kit (classify · extract components · fold · drift · check) and the three-stage flow (kit run → agent review → present + interview).
- chore(repo): plugin + marketplace manifests, skill lint, script tests, CI.
