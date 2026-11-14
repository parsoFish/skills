---
type: regex
target: { source: file, path: skills/csv-to-table/SKILL.md }
pattern: "^## W[h]en n[o]t t[o] u[s]e\\s*$"
flags: "m"
---
The new SKILL.md has a "When not to use" section, the body shape the skill-dev skill prescribes
in its step 3. Neither the prompt nor the fixture names that section, so an agent without the
skill has no reason to write it.
