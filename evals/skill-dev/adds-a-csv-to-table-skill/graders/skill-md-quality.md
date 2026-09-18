---
type: llm
weight: 1
focus: { source: file, path: skills/csv-to-table/SKILL.md }
---
This is a newly authored SKILL.md for a skill named csv-to-table. Score 1 only if ALL of the
following hold, each checked literally:
1. Frontmatter `name` is exactly `csv-to-table`.
2. Frontmatter `description` is third person and names a concrete trigger a user would type
   (converting a CSV, producing a markdown table, or similar).
3. The frontmatter contains no `<` or `>` characters.
4. The body's shape is an instruction sheet, not documentation: after an optional one-sentence
   purpose line, every section is either a numbered list whose items start with a verb (Run,
   Pass, Report, Skip ...), or a section titled "When not to use". A section that describes what
   the script does or supports (a bullet list of handled cases, an API description, a "how it
   works" explanation) fails this criterion; such material belongs in a references/ file, linked
   from a step.
5. The whole file is under 80 lines.
Score 0 if any criterion fails. Quote the failing criterion number in your explanation.
