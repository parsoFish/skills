---
type: regex
target: { source: file, path: docs/reference/infra.md }
pattern: "network[\\s\\S]*app|app[\\s\\S]*network"
---
The generated module graph names both modules ("network" and "app").
