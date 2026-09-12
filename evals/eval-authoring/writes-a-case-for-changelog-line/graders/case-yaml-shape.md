---
type: llm
weight: 1
focus: { source: file, path: evals/changelog-line/adds-one-line/case.yaml }
---
This is a newly authored case.yaml for an eval case named adds-one-line, meant to test the
changelog-line skill. Score 1 only if it declares the exact schema version string "1.1", a
`context.scaffold_script` naming fixture.sh, and a name and description that plainly describe
testing the changelog-line skill's behaviour. Score 0 if the schema version is missing, wrong, or
not quoted as a string; if the scaffold script is not wired to fixture.sh; or if the description
is generic filler rather than a real statement of what the case checks.
