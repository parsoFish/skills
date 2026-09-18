---
name: eval-authoring
description: Writes a claude plugin eval case with the correct file shapes and graders that actually discriminate, to validate that a skill or plugin change does what it claims. Use when the user asks to write an eval case, add test coverage for a skill, create an eval fixture, set up a claude plugin eval case, or wants to prove a skill change actually helps rather than just looking plausible.
license: MIT
---

# Eval authoring

A skill's frontmatter and body are a claim. A `claude plugin eval` case is the only thing that
tests the claim against a real run — with the skill available, and without it — rather than
against the author's own confidence. Getting the file shapes and grader choices right the first
time avoids the usual failure mode: a case that runs cleanly, costs real money, and proves
nothing because every grader it contains would pass with or without the skill.

## 1. State the behaviour under test

Before creating any files, write one sentence: what should be true after this run that would not
be true if the skill had not fired, or had fired badly? If that sentence is hard to write, the
case idea is probably too vague to grade — narrow it to one concrete task with a fixture that
makes the right answer knowable in advance, rather than a task any competent agent would get
right regardless of the skill.

## 2. Create the case's files

A case lives in its own folder and needs, at minimum: `prompt.md` (frontmatter for `runs`,
`max_turns`, `timeout_seconds`, `allowed_tools`, then the task prompt itself as the body),
`case.yaml` (`schema_version: "1.1"` plus `context: { scaffold_script: fixture.sh }`, a `name`,
and a `description`), and `fixture.sh` (a shell script that builds the starting repository
state). `fixture.sh` must be **hermetic** — no network access of any kind, nothing that reaches
out to a registry or a remote host — and it must end by running `git init` and committing what it
created, so the run starts from a clean, versioned tree rather than an uncommitted scratch
directory. See [references/case-format.md](references/case-format.md) for the exact shape of
each file with worked examples; the format is easy to get subtly wrong on the first attempt.

## 3. Add the "did it fire" indicator

Every case needs a grader that checks whether the skill tool was actually used. This is a
**with-only indicator**: under a with/without comparison the baseline arm never has the skill
available, so this grader can never score anything there, and it contributes nothing to the
case's aggregate score either way — its only job is to tell a human or a report reading the
result whether the skill actually engaged, separate from whether the outcome was any good.

## 4. Add at least one scored outcome grader

Add at least one grader that scores what the run produced: a file that exists only if the skill's
convention was followed, a pattern matched against real content, or a rubric judged against real
content. The fire indicator scores nothing, so a case with only that grader has a delta that is
structurally zero and proves the skill fired, not that it helped.

## 5. Point file-reading graders at a file, explicitly

A grader's default target is the transcript's **last message only** — not the files a run
produced. To grade a file instead, set an explicit file-sourced target naming the file's path (a
rubric-based grader and a pattern-based grader each use their own field name for this — see
[references/case-format.md](references/case-format.md) for both). Leaving the default in place
and then writing a rubric or pattern that talks about a file's contents is a case that passes or
fails on whatever the model happened to say in its final reply, which is rarely the same thing as
what it actually wrote to disk.

## 6. Avoid the three graders that pass for the wrong reason

- **A pattern whose text already appears in the prompt.** If the prompt asks "tell me whether it
  drifted" and the grader's pattern matches the word "drift", the without-skill arm passes by
  parroting the question back — the grader never distinguishes doing the task from restating it.
  Write patterns that name the *answer* (a specific value, edge, or identifier the fixture makes
  knowable), never a word already sitting in the prompt.
- **A file-existence check on a path the fixture already created.** This kind of grader only
  proves something when the path is expected to be produced *during the run*. If `fixture.sh`
  already wrote that file, the grader passes even if the model does nothing at all.
- **A file-existence check on a path the prompt itself dictates.** If the prompt says "put the
  test at `scripts/x.test.mjs`", any competent agent creates it with or without the skill; the
  grader passes in both arms and only shrinks the delta towards the gate's floor. Keep existence
  checks for paths the skill's *convention* supplies, and let content graders do the scoring.

## 7. Run the case and compare the arms

Run the single case in isolation and read both arms: the with-skill score, the without-skill
score, and the delta. A high with-skill score next to an equally high without-skill score means
the task didn't need the skill — narrow the fixture or the prompt until it does. Set `runs: 2` or
more in `prompt.md` for any case whose scoring leans on an LLM judge; a single run's judge vote
is one sample, and one flipped vote can drop the delta below the gate's floor. If a case grants
shell access (its `allowed_tools` includes `Bash`), every run on it needs the evaluation harness
to have a working sandbox backend available to confine that shell; without one, every run on that
case errors out before the first turn, which looks like a skill failure but is actually a harness
one — check the harness's own error message before concluding the skill is at fault.

## Before declaring the case done

- [ ] `prompt.md`, `case.yaml`, and `fixture.sh` all exist with the shapes in
      [references/case-format.md](references/case-format.md); `fixture.sh` touches no network and
      ends with `git init` plus a commit.
- [ ] Exactly one grader proves the skill fired, understood as scoring nothing on its own.
- [ ] At least one other grader scores the actual outcome — the case's delta cannot be
      structurally zero.
- [ ] Every grader that judges a file sets an explicit file target; none rely on the
      last-message default to judge file content.
- [ ] No pattern-based grader's pattern is a substring of the prompt it's paired with.
- [ ] File-existence graders only name paths the run is expected to create because the skill
      taught the convention, never paths the fixture already wrote or the prompt spelled out.
