---
type: llm
weight: 1
---
The repository has exactly three components (cli, core, web) with a two-way import between core and web, two direct dependencies (express, and leftpad which nothing imports), one env var ACME_API_TOKEN, and one CI job named test. Score 1 if the produced docs under docs/ reflect only those facts (paths cited or generated tables present), mark unknowns as GAP or questions, and never present a raw .c4 or JSON file as the human-facing deliverable. Score 0 if the docs claim components, dependencies, risks, decisions, deployment targets or services the repository does not show, or if the dependency ledger fails to flag leftpad as unused, or if the core<->web cycle is missing.
