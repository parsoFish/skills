---
type: llm
weight: 1
focus: { source: file, path: skills/csv-to-table/SKILL.md }
---
This is a newly authored SKILL.md for a skill named csv-to-table. Score 1 only if all of the
following hold: the frontmatter `name` is exactly `csv-to-table` (matching its folder); the
frontmatter `description` is written in the third person and names a concrete trigger (mentions
converting a CSV, or producing a markdown table, or similar phrasing a user would actually type);
the frontmatter contains no `<` or `>` characters; the body is written as imperative instructions
rather than descriptive prose about what an agent "should" do; and the whole file is well under
500 lines. Score 0 if the name does not match the folder, the description could plausibly never
fire or always fire, or the body is bloated with detail that belongs in a separate reference file.
