---
name: skill-dev
description: Adds a new skill to a skills repository or changes an existing one, end to end — classify the change, draft SKILL.md frontmatter and body, push detail into references/, add a script with its sibling test, add or update the eval case (delegating to the eval-authoring skill), run the repository's deterministic checks, run its agentic gate and read the score delta, then bump the version and open a PR. Use when the user asks to create a skill, add a new skill, build a skill, update or refactor an existing skill, or wants a skill change carried all the way through a skills repository's lint, test, and eval gate.
license: MIT
---

# Skill dev

Run the nine steps below in order. Each one exists because skipping it has cost a paid eval run;
[references/rationale.md](references/rationale.md) says why, step by step. Read the repository's own CLAUDE.md first: it
names the gate command, the line caps and the version rule that the steps below refer to.

## 1. Classify the change

Decide: **new skill** (fresh folder under `skills/`) or **change to an existing skill**
(frontmatter, body, script, eval case). An existing skill still goes through every step; re-read
its `description` and fix any drift from what the skill now does.

## 2. Draft the frontmatter

- Set `name` to the folder name, exactly.
- Write `description` in the third person: what the skill does, then the phrases that trigger it
  ("Use when the user asks to ..."). Name concrete triggers a user would type.
- Never put `<` or `>` in frontmatter.
- Keep only `name`, `description` and fields the skill truly needs (`license`, a short
  `compatibility` note). Put no harness-specific fields (tool allowlists) in a portable skill;
  scope those in the eval case settings instead.

## 3. Write the body as an instruction sheet

The body is what the agent reads while doing the task, so give it this shape and nothing else:

1. One sentence of purpose under the H1.
2. Numbered steps, each starting with a verb ("Run", "Pass", "Report"), in the order the work
   happens. A step names the exact command or file it acts on.
3. A "When not to use" section naming the cases the skill should decline.
4. A link to `references/<topic>.md` wherever a reader might want the detail behind a step.

Anything that describes rather than instructs (what a script handles, how it works, an API
surface, a list of supported cases) goes into that `references/` file, not the body. Stay under
the repository's `SKILL.md` line cap (commonly 500).

## 4. Add a script and its test in the same commit

- Put deterministic tooling under the skill's `scripts/`.
- Land `scripts/<name>.test.mjs` in the same commit as `scripts/<name>.mjs`.
- Keep the script pure where practical: return a new value, never mutate input.

## 5. Add or update the eval case

Use the `eval-authoring` skill for this step; do not improvise the file shapes. The case needs:

- one grader that proves the skill fired (`tool_used: Skill`), and
- at least one grader that scores the produced outcome.

## 6. Run the deterministic checks

Run the repository's lint, script tests and strict manifest validation before any agentic run.
Fix every finding; there is no cheap fix once an eval run has been paid for.

## 7. Run the agentic gate and read the delta

- Run the gate command CLAUDE.md names.
- Read the **delta** (with-skill score minus without-skill score), not only the score.
- Fix any review finding the gate reports; do not argue with it.

## 8. Bump the version and record the change

- Bump the version in the manifest the repository names as its source of truth.
- Add one changelog line under the unreleased section.

## 9. Branch, attest, open the PR

- Work on a branch; never commit to a protected main branch.
- Commit the gate's attestation alongside the change; never hand-edit it.
- Open the PR with the gate's own report as the body when the repository supports it.

## Before declaring the change done

- [ ] `name` equals the folder; `description` is third person and names a trigger; no `<`/`>`
      in frontmatter.
- [ ] `SKILL.md` is under the line cap; long detail lives in `references/`.
- [ ] Every script touched has a sibling test in the same commit.
- [ ] The eval case has a fired-grader **and** a scored outcome grader.
- [ ] Lint, tests and strict validation pass.
- [ ] The agentic gate ran on this exact change and the delta was read.
- [ ] Version and changelog reflect the change.
- [ ] The change is on a branch with the attestation committed alongside it.
