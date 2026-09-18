---
runs: 2
max_turns: 60
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
---

Add a new skill to this repository called csv-to-table that converts a CSV file into a
GitHub-flavored markdown table. Put the conversion logic in
skills/csv-to-table/scripts/convert.mjs with its test at
skills/csv-to-table/scripts/convert.test.mjs, and an eval case at
evals/csv-to-table/converts-a-simple-csv/ (including graders/skill-fired.md as the tool-use
indicator, plus at least one grader that scores the outcome). Follow this repository's own
practice for adding a skill end to end, and stop once the repository's gate command named in
CLAUDE.md passes. End with a short final message listing every file you created.
