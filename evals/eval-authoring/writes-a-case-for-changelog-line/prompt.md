---
runs: 1
max_turns: 60
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
---

This repository has a skill at skills/changelog-line/SKILL.md but no eval case for it yet. Write
one eval case for it at evals/changelog-line/adds-one-line/, following this repository's case
format: prompt.md, case.yaml, fixture.sh, and graders/skill-fired.md as the tool-use indicator,
plus at least one more grader file that scores the actual outcome. Do not run any network or paid
command — just author the case files.
