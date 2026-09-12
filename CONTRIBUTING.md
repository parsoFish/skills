# Contributing (to myself)

## Layout
```
.claude-plugin/{plugin.json,marketplace.json}   plugin + self-hosted marketplace
skills/<name>/SKILL.md                          ≤ 500 lines, frontmatter: name = folder, description = when to use (third person)
skills/<name>/references/                       long-form guidance loaded on demand
skills/<name>/scripts/                          deterministic tooling; every file has a *.test.mjs
skills/<name>/assets/                           templates, starter files
evals/<name>/<case>/{case.yaml|prompt.md,graders/*.md}   claude plugin eval cases
scripts/lint-skills.mjs · tests/                repo plumbing
```

## Authoring loop
1. `/skill-creator` to draft; iterate with-skill vs baseline on 2–3 realistic prompts before committing.
2. Description tuning: the description is the trigger. State what the skill does and the phrases that should fire it, in third person, no angle brackets.
3. `npm run check` locally. Lint catches: name/folder mismatch, description without a trigger clause, SKILL.md over 500 lines, references over 800 lines, broken relative links.
4. `plugin-dev` skill-reviewer pass for structure (imperative body, progressive disclosure, dead references).
5. Eval case: at least one `tool_used: Skill` grader (did it fire) and one outcome grader; run `npm run eval` and read the delta.
6. `/skill-doctor` occasionally: a skill nobody uses still costs context.

## Versioning and distribution
- `plugin.json` version is semver for the whole plugin; CHANGELOG.md has one line per skill change.
- Tag releases; the marketplace entry can pin `ref` + `sha` for consumers who want stability. `npx skills add` tracks the branch.
- Claude-Code-only frontmatter (`allowed-tools`) stays out of skills meant to be portable.

## Pitfalls we guard against
Generic descriptions (never fires / fires on everything) · everything in SKILL.md (context tax on every turn) · reading the score without the with/without delta · evals without `--trust-plugin` and `--max-cost-usd` in CI · Claude-only fields in portable skills.
