#!/usr/bin/env bash
# Fixture repo for the skill-dev eval: a minimal skills repository with a deterministic-only
# gate (no agentic phase), so the case can validate the authoring loop without network access or
# a real Claude Code plugin install.
set -e
mkdir -p skills evals tests
cat > package.json << 'JSON'
{
  "name": "sample-skills",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "lint": "node -e 0",
    "test": "node --test \"tests/**/*.test.mjs\" \"skills/*/scripts/**/*.test.mjs\""
  }
}
JSON
cat > CLAUDE.md << 'MD'
# sample-skills

A tiny skills repository. Every skill lives at `skills/<name>/SKILL.md`, with its folder name
matching the frontmatter `name`. Every script under `skills/*/scripts/` has a sibling
`*.test.mjs` in the same commit. Every skill needs an eval case under `evals/<name>/<case>/`.

The gate for any change is:

    npm run lint && npm test
MD
git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init
