---
type: llm
weight: 1
focus: { source: file, path: evals/changelog-line/adds-one-line/fixture.sh }
---
This is a newly authored fixture.sh for an eval case testing the changelog-line skill (which
appends one line under a CHANGELOG.md "## Unreleased" heading). Score 1 only if the script is
hermetic — it contains no curl, wget, npm install, pip install, git clone, or any http:// or
https:// URL — and it ends by running `git init` and committing what it created, so the run
starts from a clean, versioned tree. Score 0 if it reaches the network in any form, never
initializes a git repository, or never commits.
