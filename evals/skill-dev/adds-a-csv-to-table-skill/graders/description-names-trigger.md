---
type: regex
target: { source: file, path: skills/csv-to-table/SKILL.md }
pattern: "^description:.*\\bU[s]e w[h]en\\b"
flags: "m"
---
The frontmatter description carries a "Use when ..." trigger clause, as the skill-dev skill's
step 2 prescribes: what the skill does, then the phrases that trigger it. The prompt asks for a
skill but never says how its description should read.
