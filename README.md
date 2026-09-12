# parso-skills

A personal collection of Claude Code skills, packaged as one plugin and a self-hosted marketplace. Each skill carries its own deterministic tooling, tests and eval cases.

## Install

```bash
# as a Claude Code plugin (all skills)
claude plugin marketplace add parsoFish/skills
claude plugin install parso-skills@parso-skills

# or a single skill into any agent that reads SKILL.md
npx skills add parsoFish/skills --skill architecture
```

## Skills

| skill | what it does | status |
|---|---|---|
| [architecture](skills/architecture/SKILL.md) | Generates architecture design and current-state docs for any project: a deterministic kit run (extract → fold → drift → render → check), a bounded agent review, then human-facing docs plus interview questions. | scaffold, kit stage 1 partial |

## Develop a skill

1. Draft with the `skill-creator` skill (`/skill-creator`), keep `SKILL.md` under 500 lines, put detail in `references/`, tooling in `scripts/` with a `*.test.mjs` beside every script.
2. `npm run gate` — deterministic checks, then local agentic validation (`claude plugin eval` + a headless structural review) for every changed skill. Installed as the pre-push hook; CI runs the same on every PR touching a skill. `npm run gate:quick` for the deterministic half only.
3. Review with `plugin-dev`'s `skill-reviewer` agent.
4. Add an eval case under `evals/<skill>/` and run `npm run eval` (costs money; also runs in CI on the `evals` PR label or manual dispatch). Read the with/without delta, not just the score.
5. Conventional commit; entry in CHANGELOG.md; bump `plugin.json` version when a skill's behaviour changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full authoring loop and [CLAUDE.md](CLAUDE.md) for the rules an agent working in this repo follows.
