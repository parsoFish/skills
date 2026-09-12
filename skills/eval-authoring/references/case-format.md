# Case format — exact shapes

A `claude plugin eval` case is a folder. Nothing in this file is aspirational syntax — every
shape below is a shape that has actually run.

```
evals/<skill>/<case-name>/
├── prompt.md          the task prompt, plus per-run settings in frontmatter
├── case.yaml           case metadata and the fixture wiring
├── fixture.sh           builds the starting repository state
└── graders/
    ├── <fires>.md       proves the skill was used
    └── <outcome>.md      scores what actually happened
```

## `prompt.md`

Frontmatter controls how the run executes; the body below it is the literal prompt the model
sees, written the way a real user would actually phrase the request — not a spec, not a bullet
list of assertions.

```markdown
---
runs: 1
max_turns: 60
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
---

Document the architecture of this repository: I want a current-state picture of the components
and how they depend on each other. Put the output under docs/. Do not invent anything the
repository does not show.
```

- `runs` — how many times to repeat the case; keep this at `1` unless the task is genuinely
  nondeterministic and averaging over noise matters more than the cost of repeating it.
- `max_turns` — a hard ceiling on agent turns; size it to the task, not to "just in case." A
  case that hits the ceiling every run is a case whose fixture is too big for what it's testing.
- `timeout_seconds` — wall-clock budget for the whole run.
- `allowed_tools` — the exact tool list the run gets, matching what a real user session would
  actually grant. Include `Skill` whenever the case is meant to test whether a skill fires at
  all; a case can't grade skill usage if the tool that invokes skills was never on the list.
  Include `Bash` only when the task genuinely needs a shell — every case with `Bash` on this list
  needs the evaluation harness to have a sandbox backend available, or it errors before scoring.

The prompt itself must never leak the answer a grader is checking for. If a grader's pattern
names a specific value, edge, or identifier, that string must not already appear in the prompt —
otherwise the ungraded (no-skill) arm can pass by echoing the question back.

## `case.yaml`

```yaml
schema_version: "1.1"
name: document-a-small-repo
description: Document a small repository from scratch; the component graph must come from real analysis, not be invented.
context:
  scaffold_script: fixture.sh
```

- `schema_version` — pin the exact string `"1.1"`; this is the format described here.
- `name` — should match the case's own folder name.
- `description` — one sentence: what this case is actually checking, for a human skimming a
  report later.
- `context.scaffold_script` — the fixture script's filename, resolved relative to the case
  folder. Almost always `fixture.sh`.

## `fixture.sh`

A plain shell script, executable, that builds the repository the run starts inside. It must be
**hermetic**: no `curl`, `wget`, `npm install`, `pip install`, `git clone`, or any `http://` /
`https://` URL — an eval that reaches the network is an eval that fails unpredictably inside a
sandboxed run, for reasons that have nothing to do with the skill under test. It must end with
`git init` and a commit, so the run starts from a clean, versioned tree rather than an
uncommitted scratch directory a diff-based grader can't reason about.

```bash
#!/usr/bin/env bash
set -e
mkdir -p src/core src/web
echo "export const run = () => 1;" > src/core/run.js
echo "import { run } from '../core/run.js'; export const serve = () => run();" > src/web/server.js
printf '%s\n' '{ "name": "sample", "type": "module" }' > package.json
git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init
```

Every fact a grader later relies on — a module name, an unused dependency, an undeclared import
— has to trace back to something this script actually wrote. Read the fixture before writing the
grader that depends on it; guessing at what it contains is how a grader ends up checking for the
wrong thing.

## Graders

Each grader is one file under `graders/`, frontmatter plus a rubric or description below it.
Every grader type has a `weight` you can set to change its share of the case's score (default
`1`); most cases leave it at the default.

### `tool_used` — the fire indicator

```markdown
---
type: tool_used
tool: Skill
---
The skill was invoked for the documentation request.
```

Scores whether a named tool was called at all during the run. This is the with-only indicator:
the baseline (no-skill) arm has no `Skill` tool available, so this grader cannot score anything
useful there, and it does not count toward the case's aggregate score in either arm. Its purpose
is entirely diagnostic — a report can say "the skill never even fired" instead of just "it scored
low."

### `file_exists` — did the run produce this path

```markdown
---
type: file_exists
path: docs/reference/components.md
---
The kit's generated component table exists, proving analysis ran rather than the agent writing
docs by hand.
```

Checks that a path exists **after the run**. This only proves something for paths the run is
expected to create — if `fixture.sh` already wrote that file, this grader is trivially satisfied
regardless of what the model did.

### `regex` — pattern match against a target

```markdown
---
type: regex
target: { source: file, path: docs/reference/components.md }
pattern: "core.*web|web.*core"
flags: "i"
---
The generated component table records the two-way import between core and web.
```

Without an explicit `target`, this grader reads the transcript's **last message only** — a
common mistake is to write a pattern about file content while leaving the default target in
place, which then grades whatever the model happened to say instead of what it wrote to disk. Set
`target: { source: file, path: <path> }` whenever the pattern is about a file's content. Never
write a pattern whose literal text already appears in the case's `prompt.md` — see the trap
above.

### `llm` — a rubric judged by a model

```markdown
---
type: llm
weight: 1
focus: { source: file, path: docs/architecture/overview.md }
---
This overview was written for a repository with exactly two components (core, web) and no
database, deployment target, or external service of any kind. Score 1 if every structural claim
is one of those facts or is explicitly marked as a gap or a question. Score 0 if it asserts
components, services, or integrations the repository does not show.
```

Use `focus: { source: file, path: <path> }` to judge a specific produced file; omit it only when
the rubric is genuinely about the conversation itself (for example, "did the final reply report
which files it created"), since the default judges the last message only. Write the rubric so a
reader with no other context — who has never seen the fixture — can still tell exactly what
"score 1" versus "score 0" means: name the specific facts the fixture makes true, not a vague
"is this good documentation."

## Running the case

Run the single case in isolation and read both arms of the result: with-skill score,
without-skill score, and the delta between them. A `tool_used` grader never moves that delta; only
the outcome graders do. If both arms score about the same, the fixture or the prompt hasn't yet
forced a situation where the skill actually changes the result — narrow it until it does.
