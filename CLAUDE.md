# parso-skills — repo instructions

This repo is a personal collection of Claude Code skills packaged as one plugin and a self-hosted marketplace. Each skill lives in `skills/<name>/` with `SKILL.md`, `references/`, `scripts/`, `assets/`. Deterministic tooling a skill needs ships inside its `scripts/` and is unit-tested.

Rules:
- A skill's `SKILL.md` stays under 500 lines; detail goes to `references/`. Description is third person, names the trigger phrases, no `<` or `>`.
- Every script has a `*.test.mjs` next to it. `npm test` must pass before a skill is added to CHANGELOG.
- `npm run gate` is the merge gate for any skill change: deterministic checks (lint, tests, strict validate, skill-creator quick_validate) then agentic validation (`claude plugin eval` on the changed skills + a headless structural review), cost-capped. It runs as the pre-push hook and in CI on every PR touching `skills/` or `evals/`. Do not bypass it; `SKILLS_GATE_SKIP_AGENTIC=1` exists only for a broken harness and is recorded.
- Every skill needs an eval case under `evals/<skill>/` with a `tool_used: Skill` grader; lint fails without one.
- Authoring loop: draft with the `skill-creator` skill, review with `plugin-dev`'s `skill-reviewer`, then add an eval case under `evals/<skill>/`.
- Conventional commits; no AI attribution lines.
