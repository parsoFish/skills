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
3. The frontmatter (the block between the two `---` lines) contains no `<` or `>` characters.
   Angle brackets in the body, such as a placeholder in a command, do not fail this criterion.
4. The body is an instruction sheet. It PASSES when it has (a) a numbered list of steps in which
   every item begins with an imperative verb ("Run ...", "Write ...", "Report ...") or a condition
   followed by one ("If X, write ..."), and (b) a section headed "When not to use". A short
   purpose sentence under the title, a "Steps" heading, and a one-line pointer to a `references/`
   file are all fine. It FAILS only if the body contains a section headed "Usage", "Notes", "How it
   works", "Options", "API" or "Supported", or a bulleted list or paragraph explaining the
   script's parsing, quoting, escaping or padding rules. Bullets under "When not to use" that name
   cases to decline are instructions, not explanations.
5. The whole file is under 80 lines.
