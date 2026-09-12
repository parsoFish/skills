# parso-skills — the one file an agent reads first

A personal collection of Claude Code skills, published as one plugin and a self-hosted marketplace.
Each skill is standalone, portable, tested, and validated by a real agentic eval before it ships.
Node 22, no runtime dependencies, MIT. `AGENTS.md` points here; there is no second entry point.

## Layout

    .claude-plugin/{plugin.json,marketplace.json}  plugin + marketplace manifests (version lives here)
    skills/<name>/SKILL.md                         PUBLISHED. 500 lines max, name = folder
    skills/<name>/{references,scripts,assets}/     detail on demand; tooling (+ a *.test.mjs each)
    evals/<skill>/<case>/                          prompt.md + case.yaml + fixture.sh + graders/*.md
    evals/{gate-report.json,attest/,REPORT.md,ledger.md}  attestation, evidence, report, spend
    scripts/                                       gate, attest, report, release, clean, protect-main
    tests/                                         repo plumbing tests
    docs/gate-runbook.md                           what to do when the gate fails
    .github/ISSUE_TEMPLATE/                        the work queue's issue forms

## The loop — every change, no exceptions

1. Pick work: `gh issue list --label agent-ready`. Nothing ready? Ask; do not invent scope.
2. Branch: `git checkout -b <type>/<slug>`. Never commit on `main` — it is protected.
3. Change the skill. A script and its `*.test.mjs` land in the same commit. Test first.
4. Eval case: every skill needs at least one case with a `tool_used: Skill` grader AND at least
   one scored outcome grader. Lint fails without the first; the delta is 0 without the second.
5. `npm run gate:quick` while iterating — deterministic only, spends nothing, NOT a merge gate.
6. `npm run gate` when done, detached (below); then `npm run report`; commit `evals/` with the change.
7. Version: any change under `skills/` bumps `plugin.json` (`npm run release:bump -- patch`)
   and adds a `CHANGELOG.md` line under `## Unreleased`. CI's `attested` job fails the PR without both.
8. PR: `gh pr create --fill --body-file evals/REPORT.md`, then `gh pr checks --watch`.
   Read the conclusions, not the exit code — `gh pr checks` exits 0 on "no checks reported".
9. Merge: `gh pr merge --squash --delete-branch`. Never `--admin`. Never `git add -A`.
   `git checkout` never shares a command line and never takes `.`.

## The gate is the merge gate

`npm run gate` = deterministic half, then the agentic half:

    lint                               frontmatter, caps, links, forbidden terms, eval coverage
    npm test
    claude plugin validate . --strict  manifests ONLY; it does not read SKILL.md frontmatter
    skill-creator quick_validate.py    per changed skill
    claude plugin eval                 one case at a time, with-without ablation
    headless structural review         JSON-schema verdict, read-only tools

A case passes only when `score >= threshold` AND `delta >= minDelta` AND `partial` is false AND no
arm errored. Thresholds live in `gate.config.json`; nothing is hardcoded. A pass writes an
attestation: `skillsDigest` + `harnessDigest` over git blob SHAs, the commit, the cost, and the
per-case evidence under `evals/attest/`. CI's `attested` job recomputes both digests and re-checks
every case — a skill edited after the gate ran, or a case the gate never covered, fails the PR.
Check an already-attested tree without re-running anything: `npm run attest`; this is also what the
`gate:verify` pre-push hook runs (deterministic checks + attestation verify, spends nothing).

Run the agentic gate detached on this host; Claude Code's low-memory guard kills background tasks:

    setsid nohup node scripts/gate.mjs --all --force > /tmp/gate.log 2>&1 &

`gate:quick` and `SKILLS_GATE_SKIP_AGENTIC` never produce an attestation, so they can be pushed and
can never be merged. A bypass needs `SKILLS_GATE_BYPASS_REASON` and is recorded forever.
`npm run clean` prunes old `evals/results/` runs; the gate calls it after a pass.
When a step fails, go to [docs/gate-runbook.md](docs/gate-runbook.md) — one section per step name.

## Writing a skill

- `name` equals the folder. `description` is third person, says when to use it, names the trigger
  phrases, and contains no angle brackets. The description is the trigger; a generic one never
  fires or always fires.
- `SKILL.md` 500 lines max, imperative, progressive disclosure; detail goes to `references/` (800 max).
- Nothing in `skills/` or `evals/` may name the author, this repo, or any of the author's other
  projects (`lint.config.json` enforces it). A skill must work in a stranger's repo on first try.
- No Claude-Code-only frontmatter (`allowed-tools`) in a skill meant to be portable.
- Fixtures are hermetic: no network in `fixture.sh`, ever. Pin every external tool exactly.
- Graders that judge a file need `focus: {source: file, path: ...}` — the default judges the last
  message only. `file_exists` counts only files the run created. Never write a regex whose pattern
  already appears in the prompt: it passes without the skill.

## Release and protection

`plugin.json.version` is the single source of truth; `claude plugin validate --strict` fails if the
marketplace entry disagrees. `npm run release:bump -- <patch|minor|major>` updates both
manifests, `package.json`, the CHANGELOG section, and the marketplace `ref` pin. Pushing that to
main makes `release.yml` create tag `vX.Y.Z` and the GitHub release. `main` is protected: required
checks `deterministic` + `attested`, linear history, no force-push, `enforce_admins: false` (a
deliberate escape hatch — its use is worth a line in the ledger, not a rule change). Consumers:

    claude plugin marketplace add parsoFish/skills && claude plugin install parso-skills@parso-skills
    npx skills add parsoFish/skills --skill architecture   # a single skill into any SKILL.md-reading agent

## Never

- Never merge on the absence of red; a gate reporting no checks is not a green gate.
- Never bypass the gate to get a change in. Fix the skill, or file the harness defect as `kit-gap`.
- Never hand-edit `evals/gate-report.json`, `evals/attest/**` or `evals/REPORT.md` — they are evidence.
- Never change `gate.config.json` in the same PR as a change under `skills/`.
- Never add a runtime dependency, a feature flag or a compatibility shim. There are no legacy users.
- Never add path filters to a workflow whose job is a required check (it stays pending forever).
- Never ship a skill without an eval case, a scored outcome grader, and a recorded delta.

## Park — produce the artifact, say so, and stop

A new external dependency; a change that contradicts this file (fix the file first); a finding that
needs the owner's judgement (open a `needs-decision` issue); anything that would make a published
skill repo-specific.
