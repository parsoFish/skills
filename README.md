# parso-skills

A personal collection of Claude Code skills, packaged as one plugin and a self-hosted marketplace.
Each skill carries its own deterministic tooling, tests and eval cases, validated by a real agentic
run before it ships — see [CLAUDE.md](CLAUDE.md) for the gate that enforces that.

## Install

```bash
# rolling — tracks the latest tagged release via the marketplace's pinned `ref`
claude plugin marketplace add parsoFish/skills
claude plugin install parso-skills@parso-skills

# edge — a local clone, for trying an unreleased change
git clone https://github.com/parsoFish/skills && claude plugin marketplace add ./skills

# a single skill into any agent that reads SKILL.md (not Claude-Code-specific)
npx skills add parsoFish/skills --skill architecture
```

## Skills

| skill | what it does | status |
|---|---|---|
| [architecture](skills/architecture/SKILL.md) | Generates and maintains architecture design and current-state docs for any project: a deterministic kit run (classify → extract → fold → drift → render → check), then one bounded agent review that drafts the written docs with evidence tiers, then a human-facing bundle plus interview questions. | Three-stage flow (kit run → agent review → present); 11 extractors including offline-default, dependency-cruiser-opt-in, Go and Terraform engines; shrink-only drift ratchet gating CI; agent map (`AGENTS-ARCH.md`); self-contained HTML bundle; 3 eval cases (Δ 1, 1, 0.5). |

## Develop a skill

1. Draft with the `skill-creator` skill, keep `SKILL.md` under 500 lines, put detail in
   `references/`, tooling in `scripts/` with a `*.test.mjs` beside every script.
2. Write an eval case under `evals/<skill>/` — a `tool_used: Skill` grader plus at least one
   scored outcome grader (`skill-creator` and `eval-authoring` cover the shape; see CONTRIBUTING).
3. `npm run gate` — deterministic checks, then local agentic validation (`claude plugin eval` +
   a headless structural review) for every changed skill. `npm run gate:quick` for the
   deterministic half only, while iterating. Neither is a substitute for the other: only a full
   `gate` pass produces the attestation CI checks for on a PR.
4. Bump the version and add a CHANGELOG line: `npm run release:bump -- patch` (or `minor`/`major`).
   Conventional commit, PR, `gh pr checks --watch`, squash-merge.

Full authoring detail (case file shapes, grader pitfalls, versioning) lives in
[CONTRIBUTING.md](CONTRIBUTING.md). The rules an agent follows while working in this repo —
the loop, the gate contract, branch/PR/merge protocol, the never-dos — live in one place:
[CLAUDE.md](CLAUDE.md). When the gate fails, [docs/gate-runbook.md](docs/gate-runbook.md) has a
section per failure.
