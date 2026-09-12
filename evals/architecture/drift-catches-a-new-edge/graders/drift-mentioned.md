---
type: llm
weight: 1
focus: { source: file, path: docs/reference/drift.md }
---
The fixture's source now imports src/util/helper.js from src/cli/main.js — a component-level
edge from `cli` to `util` that the seeded hand.c4 never declared and the empty
drift-baseline.json never accepted as debt. This file is the kit's regenerated hand-model-vs-code
comparison. Score 1 only if it records that edge as drift: its verdict line reports at least one
unexplained edge, and its "code shows, hand does not claim" table has a row whose `from` is `cli`
and whose `to` is `util`. Score 0 if the file reports a clean re-check, omits that row, or the
file is missing (which means the drift check was never actually re-run).
