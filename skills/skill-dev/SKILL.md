---
name: skill-dev
description: Adds a new skill to a skills repository or changes an existing one, end to end — classify the change, draft SKILL.md frontmatter and body, push detail into references/, add a script with its sibling test, add or update the eval case (delegating to the eval-authoring skill), run the repository's deterministic checks, run its agentic gate and read the score delta, then bump the version and open a PR. Use when the user asks to create a skill, add a new skill, build a skill, update or refactor an existing skill, or wants a skill change carried all the way through a skills repository's lint, test, and eval gate.
license: MIT
---

# Skill dev

A skills repository that gates changes with lint, tests, and an eval suite treats "add a skill"
as a small, repeatable loop, not a one-off edit. Skip a step and the gate finds out — usually
after the cost of an agentic eval run has already been spent. Work through the steps below in
order; each one exists because skipping it was tried and found expensive.

## 1. Classify the change

Decide, before writing anything: is this a **new skill** (a fresh folder under `skills/`) or a
**change to an existing skill** (frontmatter, body, a script, or its eval case)? A change to an
existing skill still goes through every step below except drafting fresh frontmatter — but check
the frontmatter anyway; a description that drifted from what the skill now does is a common,
easy-to-miss regression.

## 2. Draft the frontmatter

`name` **must equal the folder name** — repository lint typically enforces this, and a mismatch
fails loudly. `description` is the entire triggering mechanism: nothing else in the file
influences whether the skill fires. Write it in the third person, state what the skill does, and
name the phrases or contexts that should trigger it ("Use when the user asks to ..."). A generic
description either never fires or always fires; both are useless. Never use `<` or `>` in the
frontmatter — many parsers choke on them and some lints reject them outright.

Keep frontmatter minimal: `name`, `description`, and only the fields the skill genuinely needs
(a license, a small `compatibility` note). A skill meant to work in more than one agent harness
should avoid harness-specific fields baked into the skill itself (a tool-allowlist tied to one
product); that scoping belongs in the eval case's own settings, not in the skill.

## 3. Write the body — imperative, and small

The body loads into context every time the skill fires, so every line in it is a recurring cost.
Write it in the imperative ("run", "write", "classify"), not descriptive prose about what an
agent "should" do. Keep `SKILL.md` itself under the repository's line cap (a common ceiling is
500 lines) with **progressive disclosure**: anything that is detail rather than sequence — a long
reference table, a file-format spec, per-framework variants — goes into `references/*.md`
instead, linked from the point in the body where it's needed ("see `references/x.md` for the
exact shape"). A reader who never needs the detail never pays for it; one who does gets it
exactly when they ask for it.

## 4. Add a script and its test in the same commit

If the skill needs deterministic tooling (a transform, an extractor, a generator), put it under
the skill's own `scripts/` folder and write its test **in the same commit**, not as a follow-up. A
script without a sibling test is a script nobody has verified does what the skill's prose claims
it does, and the repository's test runner is usually wired to discover `scripts/**/*.test.mjs`
automatically. Keep the script pure where practical — a function that returns a new value rather
than mutating its input makes the test trivial to write and the behaviour easy to reason about
from the skill's prose alone.

## 5. Add or update the eval case — delegate it

A skill's frontmatter and body are a claim about behaviour; only a real end-to-end run against a
fixture proves the claim. Getting the file shapes and grader choices right — which grader proves
the skill engaged versus which grader actually scores the outcome — is its own skill: use the
`eval-authoring` skill for this step rather than improvising the shapes from memory. Every skill
needs at least one case with a grader that proves it fired **and** at least one grader that
scores the produced outcome; a case with only the first can look perfect and still prove nothing.

## 6. Run the deterministic checks

Before spending anything on an agentic run, run the repository's fast checks: its lint (which
usually enforces the frontmatter rules above, a line cap, and that every skill has an eval case),
its script tests, and any strict plugin or manifest validation it ships. These catch the
mechanical mistakes — a name that doesn't match its folder, a broken relative link, a missing
test — before they cost anything to discover.

## 7. Run the agentic gate — and read the delta, not just the score

Once the deterministic checks are clean, run the repository's gate command (its CLAUDE.md names
it). This is the step that runs the eval case with the skill available and, usually, without it,
then compares the two. **The score alone is not the signal**: a task an agent can already do well
without the skill can score high in both arms and still tell you nothing about whether the skill
helped. Read the *delta* between the with-skill and without-skill arms — that is the number that
says the skill changed the outcome. If the gate's review step flags a finding, fix it before
moving on rather than arguing with it.

## 8. Bump the version and record the change

A skill repository that ships as a plugin usually keys its version off one manifest file and
expects one changelog line per change. Bump the version and add the changelog entry before opening
the PR — a gate that enforces "version bumped, changelog touched" will otherwise reject the
change regardless of how good the skill itself is.

## 9. Branch, attest, open the PR

Work on a branch, never directly on the repository's main branch if it is protected. Once the
gate passes, its attestation — a record of exactly what was validated, tied to the commit — is
the evidence a reviewer or a required check looks for; commit it alongside the change rather than
hand-editing it. Where the repository supports it, open the PR with the gate's own report as the
body: it is a more trustworthy account of what changed than a hand-written summary.

## Before declaring the change done

- [ ] `name` in frontmatter equals the folder name; `description` is third person and names a
      trigger phrase; no `<`/`>` anywhere in frontmatter.
- [ ] `SKILL.md` is under the repository's line cap; anything long lives in `references/` instead.
- [ ] Every script added or touched has a sibling test, added in the same commit.
- [ ] An eval case exists (new or updated) with a grader proving the skill fired **and** at least
      one grader that scores the actual outcome.
- [ ] The repository's deterministic checks pass (lint, tests, strict validation).
- [ ] The repository's agentic gate has run on this exact change, and the with/without **delta**
      was read, not just the raw score.
- [ ] The version and changelog reflect this change, if the repository requires that.
- [ ] The change is on its own branch with the gate's attestation committed alongside it.
