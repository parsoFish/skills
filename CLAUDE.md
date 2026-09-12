# parso-skills — repo instructions

This repo is a personal collection of Claude Code skills packaged as one plugin and a self-hosted marketplace. Each skill lives in `skills/<name>/` with `SKILL.md`, `references/`, `scripts/`, `assets/`. Deterministic tooling a skill needs ships inside its `scripts/` and is unit-tested.

Rules:
- A skill's `SKILL.md` stays under 500 lines; detail goes to `references/`. Description is third person, names the trigger phrases, no `<` or `>`.
- Every script has a `*.test.mjs` next to it. `npm test` must pass before a skill is added to CHANGELOG.
- `npm run check` = lint + tests + `claude plugin validate --strict`. Evals (`npm run eval`) cost money: run them on demand or on the `evals` label in CI, never on every push.
- Authoring loop: draft with the `skill-creator` skill, review with `plugin-dev`'s `skill-reviewer`, then add an eval case under `evals/<skill>/`.
- Conventional commits; no AI attribution lines.
