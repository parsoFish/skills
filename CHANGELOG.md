# Changelog

All notable changes to this repo. Conventional commits drive entries; one line per skill change.

## Unreleased
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
