---
name: release
description: Cuts a release of this skills plugin after a merge to main — verifies main is green and the attestation is fresh, bumps the version, opens the release PR, and smoke-tests the published marketplace install. Use when the user asks to cut a release, ship a new version, tag a release, or publish the plugin.
---

# Release

Only run this against `main`, and only after the change you're releasing is already merged.

## 1. Verify main is green and the attestation is fresh

- `gh pr checks --watch` was already read on the merge PR (the conclusions, not the exit code) —
  don't re-derive that here, but do confirm the merge actually landed on `main`.
- `evals/gate-report.json` on `main` must have `attested: true`, `bypass: null`, and a
  `generatedAt` within `gate.config.json`'s `maxAttestationAgeDays`. If it's stale or missing, run
  the `gate-run` skill against `main` first — a release is only as trustworthy as the attestation
  it's built on.

## 2. Bump the version

`node scripts/release.mjs bump <patch|minor|major>` — pick the level from what actually shipped
(a new skill or a behaviour change is at least `minor`; a docs/grader-only fix is `patch`). This
updates `plugin.json`, the marketplace entry, `package.json`, and rolls the CHANGELOG's
`## Unreleased` section into a dated one, together.

## 3. Validate

`npm run validate` must pass with all three version fields agreeing. Do not hand-edit any of them
if it fails — fix `release.mjs`'s output or re-run the bump.

## 4. PR, gate, merge

Branch, commit the version bump, open the PR, run the gate on it (`gate-run` skill), and merge
following the repository's usual merge protocol (`gh pr checks --watch`, read conclusions never
exit codes, `gh pr merge --squash --delete-branch`).

## 5. Confirm the tag and release exist

After the merge, `release.yml` runs on push to `main` and creates tag `vX.Y.Z` plus a GitHub
release whose body is that version's CHANGELOG section. Confirm both exist
(`gh release view vX.Y.Z`) before telling the user it's done — the workflow can fail silently if
the tag already existed.

## 6. Smoke-test the published install

In a scratch directory outside this checkout:

```
claude plugin marketplace add parsoFish/skills
claude plugin install parso-skills@parso-skills
```

Then run one skill against a throwaway repo (not this one, and not the owner's other projects) to
confirm the pinned release actually installs and fires. Report what you ran and what happened —
a release that doesn't install is worse than no release.
