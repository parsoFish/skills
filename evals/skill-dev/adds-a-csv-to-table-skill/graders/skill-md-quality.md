---
type: llm
weight: 1
focus: { source: file, path: skills/csv-to-table/SKILL.md }
---
This is a newly authored SKILL.md for a skill named csv-to-table. Score 1 only if ALL five
criteria hold; quote the number of any criterion that fails.
1. Frontmatter `name` is exactly `csv-to-table`.
2. Frontmatter `description` is third person and names a concrete trigger a user would type
   (converting a CSV, producing a markdown table, or similar).
3. The frontmatter contains no `<` or `>` characters.
4. The body is an instruction sheet, judged at the section level: it has (a) at most two
   sentences of prose before its first list, (b) a numbered list of steps in which every item
   tells the agent what to do (an imperative such as "Run ...", or a condition followed by one
   such as "If X, write ..."), and (c) a section titled "When not to use". A one-line pointer to a
   `references/` file may appear anywhere. It FAILS only if some section describes rather than
   instructs: a list of what the script handles or supports, an API or library usage section, or a
   "how it works" explanation. Such material belongs in a references/ file.
5. The whole file is under 80 lines.
