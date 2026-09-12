---
type: llm
weight: 1
focus: { source: file, path: docs/reference/deps.md }
---
This is the generated dependency ledger. The repository declares exactly two direct dependencies: express (imported by src/cli/main.js) and leftpad (imported by nothing). Score 1 if the table lists exactly those two, marks leftpad as unused, and shows an import site for express. Score 0 if it lists other dependencies, misses leftpad's unused flag, or the file is missing.
