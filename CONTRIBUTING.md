# Contributing (to myself)

This file owns skill-authoring detail: case file shapes, grader pitfalls, and versioning
mechanics. The loop (branch → change → gate → PR → merge), the gate's own contract, and the
never-dos live in [CLAUDE.md](CLAUDE.md) — this file doesn't repeat them. Install instructions
live in [README.md](README.md).

## Layout

```
.claude-plugin/{plugin.json,marketplace.json}   plugin + self-hosted marketplace
skills/<name>/SKILL.md                          ≤ 500 lines, frontmatter: name = folder, description = when to use (third person)
skills/<name>/references/                       long-form guidance loaded on demand (≤ 800 lines each)
skills/<name>/scripts/                          deterministic tooling; every file has a *.test.mjs
skills/<name>/assets/                            templates, starter files
evals/<name>/<case>/prompt.md                   frontmatter: runs, max_turns, timeout_seconds, allowed_tools
evals/<name>/<case>/case.yaml                    schema_version "1.1", context.scaffold_script: fixture.sh
evals/<name>/<case>/fixture.sh                    hermetic scaffold script — no network, ends with `git init` + a commit
evals/<name>/<case>/graders/*.md                  one grader per file
scripts/ · tests/                                repo plumbing (gate, attest, report, release, lint, clean)
```

## Case authoring

- **`fixture.sh` must be hermetic.** No `curl`/`wget`/`npm install`/`pip install`/`git clone`/any
  `http` URL — a case that needs the network is a case that fails in the eval sandbox. It ends
  with `git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init` so the
  run starts from a clean, committed tree.
- **A `tool_used: Skill` grader scores nothing.** Under with/without ablation it's a with-only
  indicator ("did the skill fire") — it does not contribute to `score` or `delta`. Every case
  needs **at least one scored outcome grader** too, or the delta is structurally 0 regardless of
  how well the skill did.
- **Graders default to judging the last message only.** A grader that needs to read a produced
  file must say so explicitly: `focus: {source: file, path: docs/reference/drift.md}`. A `regex`
  grader with no file `focus` is checking the chat transcript, not the output.
- **Never write a regex whose pattern already appears in the prompt.** It passes in the
  without-skill arm too, which means it isn't testing anything — this sank an early drift-eval
  case where "no drift found" satisfied a grader looking for the word "drift".
- `file_exists` graders only count files the run itself created, not fixtures already present.

## Authoring loop

1. Draft with the `skill-creator` skill; iterate with-skill vs. a baseline run on 2–3 realistic
   prompts before committing to a description.
2. Description tuning: the description is the trigger. State what the skill does and the phrases
   that should fire it, in third person, no angle brackets.
3. `npm run check` locally. Lint catches: name/folder mismatch, description without a trigger
   clause, `SKILL.md` over 500 lines, `references/` over 800 lines, broken relative links, and a
   missing eval case.
4. `plugin-dev`'s `skill-reviewer` pass for structure (imperative body, progressive disclosure, no
   dead references) — the gate's own headless structural review repeats a stricter version of
   this on every push, but a local pass first is cheaper.
5. Write the eval case (see Case authoring above; the `eval-authoring` skill covers the shape end
   to end). Run `npm run gate:quick` while iterating on everything except the eval case itself,
   then a full `npm run gate` (detached — see CLAUDE.md) to see the real with/without delta.
6. `/skill-doctor` occasionally: a skill nobody uses still costs context on every turn.

## Versioning and distribution

- `plugin.json.version` is the single source of truth for the whole plugin; `claude plugin
  validate --strict` fails the moment the marketplace entry disagrees with it.
- `npm run release:bump -- <patch|minor|major>` (`node scripts/release.mjs bump <level>`) is the
  only supported way to change the version: it updates `plugin.json`, the marketplace entry,
  `package.json`, and rolls `CHANGELOG.md`'s `## Unreleased` section into a dated one, all
  together. Never hand-edit a version field.
- The marketplace entry pins releases as `"source": {"source": "github", "repo": "parsoFish/skills",
  "ref": "vX.Y.Z"}` — verified against `claude plugin validate --strict`. A `ref` **and** `sha`
  pair directly on the entry is not a valid field and fails validation; don't reintroduce it.
- `npx skills add` installs straight from the repository's default branch — it does not track a
  release tag, so a single-skill consumer always gets the latest commit on `main`, not the latest
  numbered release.
- Claude-Code-only frontmatter (`allowed-tools`) stays out of skills meant to be portable.

## Pitfalls we guard against

Generic descriptions (never fires / fires on everything) · everything crammed into `SKILL.md`
instead of `references/` (context tax on every turn) · reading the score without the with/without
delta · a `tool_used: Skill` grader mistaken for a scored one · a regex grader with no file `focus`
silently grading the chat transcript instead of the output · a regex pattern that's just an echo of
the prompt · Claude-only fields in a portable skill · assuming `claude plugin validate --strict`
checks `SKILL.md` frontmatter — it validates the manifests only, `npm run lint` is what catches
that.
