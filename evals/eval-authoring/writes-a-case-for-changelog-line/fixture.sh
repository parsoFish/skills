#!/usr/bin/env bash
# Fixture repo for the eval-authoring eval: one trivial published skill with no eval case yet, so
# the case can validate the authoring loop without network access or a real Claude Code plugin
# install.
set -e
mkdir -p skills/changelog-line evals tests
cat > package.json << 'JSON'
{
  "name": "sample-skills",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "lint": "node -e 0",
    "test": "node --test \"tests/**/*.test.mjs\""
  }
}
JSON
cat > CLAUDE.md << 'MD'
# sample-skills

A tiny skills repository. Skills live at `skills/<name>/SKILL.md`; eval cases live at
`evals/<name>/<case>/` (`prompt.md`, `case.yaml`, `fixture.sh`, `graders/*.md`). The gate for any
change is:

    npm run lint && npm test
MD
cat > skills/changelog-line/SKILL.md << 'MD'
---
name: changelog-line
description: Writes one CHANGELOG.md line for a described change, in Conventional Commits style. Use when the user asks to add a changelog entry, log a change for release notes, or summarize a diff as a changelog line.
---

# Changelog line

Given a plain-language description of a change, append one line under the current "## Unreleased"
heading of CHANGELOG.md, formatted as `- <type>(<scope>): <summary>` (type is one of feat, fix,
refactor, docs, test, chore, perf, ci). Ask which type applies if it is not obvious from the
description. Create the "## Unreleased" heading at the top of CHANGELOG.md if it is missing.
MD
git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init
