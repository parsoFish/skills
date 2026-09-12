# Gate runbook

What to do when `npm run gate` (or CI's `deterministic` / `attested` jobs) reports a failure. Each
heading below is one of the gate's own step names — jump straight to the one that failed. Under
`attest verify`, each `###` heading is one of `scripts/attest.mjs verify`'s named failure reasons.

Never read `gh pr checks`'s **exit code** — see the section at the bottom. Read the conclusions.

The agentic half is slow and costs money. Run it detached, never in the foreground:

```
setsid nohup node scripts/gate.mjs --all --force > /tmp/gate.log 2>&1 &
```

Then poll `/tmp/gate.log` (or `tail -f`) for one of the three verdict lines. Claude Code's own
low-memory guard on this host kills long-running foreground background tasks, which is why `setsid
nohup … &` and not a bare `&` — the job must detach from the shell that spawned it.

## lint

**What it means:** `scripts/lint-skills.mjs` failed. **Why it fires:** a `SKILL.md` is missing
required frontmatter, `name` doesn't match its folder, the description has no trigger clause or
contains `<`/`>`, `SKILL.md` or a `references/*.md` file is over its line cap, a relative link is
broken, a skill has no eval case with a `tool_used: Skill` grader, or a forbidden term
(`lint.config.json`) appears under `skills/` or `evals/`. **Fix:** `node scripts/lint-skills.mjs`
prints every violation with the file and, for forbidden terms, the line. Fix the named file and
re-run; there is no bypass for this step.

## tests

**What it means:** `npm test` failed. **Why it fires:** a script's own `*.test.mjs` broke, usually
because the script it tests changed shape. **Fix:** `npm test` (or `node --test <file>` for one
file) prints the failing assertion and a stack. Fix the code or the test — whichever is wrong — and
re-run. A script without a passing sibling test never ships.

## plugin validate --strict

**What it means:** `claude plugin validate . --strict` failed. **Why it fires:** `plugin.json` or
the marketplace entry is malformed, or their versions disagree (this is the check that catches a
missed version bump on the manifest side). It validates **manifests only** — it does not read
`SKILL.md` frontmatter at all; `npm run lint` is what catches a broken skill description. **Fix:**
the CLI names the exact field and file. If it's a version mismatch, `node scripts/release.mjs bump
<level>` sets both manifests together. Confirm afterwards that the command targets the marketplace
manifest, not the plugin root: `claude plugin validate . --strict` should print "Validating
marketplace manifest…", not the "CLAUDE.md at the plugin root is not loaded" warning.

## skill-creator quick_validate

**What it means:** Anthropic's `skill-creator` `quick_validate.py` failed on a changed skill.
**Why it fires:** structural issues `quick_validate.py` checks beyond this repo's own lint — most
commonly a missing `license` field or a script referenced from `SKILL.md` that doesn't exist.
**Fix:** the step's own output names the file and rule. If the step instead reports
"skill-creator not installed", run `claude plugin install skill-creator@anthropic-agent-skills`
(the gate cannot proceed without it — this is a required check, not optional tooling).

## eval case with Skill grader

**What it means:** a changed skill has no eval case under `evals/<skill>/` carrying a
`tool_used: Skill` grader. **Why it fires:** every published skill needs at least one case that
proves the skill actually fires, or the agentic half has nothing trustworthy to run. **Fix:** add
`evals/<skill>/<case>/{prompt.md,case.yaml,fixture.sh,graders/skill-fired.md}` — delegate the shape
to the `eval-authoring` skill. Remember the `tool_used: Skill` grader is a with-only indicator that
scores nothing under with/without ablation; the case also needs at least one **scored outcome**
grader or its delta is structurally 0.

## claude plugin eval

**What it means:** the agentic half ran but a case failed, or the harness itself failed before the
first turn. **Why it fires, case failure:** `score < threshold`, `delta < minDelta`, `partial ===
true`, or an arm errored (`gate.config.json` holds the thresholds — nothing is hardcoded). Read the
per-case grader explanations in `evals/attest/<case>.json` or the HTML report under
`evals/results/<timestamp>/`; a low delta usually means the without-skill arm already scores high,
which means the case isn't discriminating and needs a sharper grader, not a lower `minDelta`.
**Why it fires, harness failure ("HARNESS:" prefix):**
- *no sandbox backend for Bash-granting evals* — install it: `sudo apt-get install -y bubblewrap socat` (Debian/Ubuntu/WSL), then re-run.
- *unreadable PATH entries block the sandbox* (keychain credential helpers, a Windows-mounted PATH directory on WSL) — the gate already sanitises `PATH`; check `SKILLS_GATE_REAL_HOME` was set correctly and that the original `HOME` still has a working `.claude` directory to symlink from.
- *Docker credential store symlinks block the sandbox* — the gate already swaps `HOME` to hide `~/.docker`; if this still fires, check for a *second* Docker config path (`DOCKER_CONFIG` set elsewhere in the environment) that the sandbox can also see.
- *Claude is not logged in under the gate HOME* — run `claude /login` (the throwaway `HOME` the sandbox uses symlinks `~/.claude` and copies `~/.claude.json` from your real `HOME`, so logging in for real fixes this).
**Fix, in general:** re-run detached (see the top of this file) after applying the remedy above;
`--force` re-runs even a cached pass.

## structural review

**What it means:** the headless reviewer returned `verdict: "fail"`, or no structured verdict at
all. **Why it fires:** a critical or major finding against skill-authoring best practice (a bad
trigger description, everything crammed into `SKILL.md` instead of `references/`, a dead link, a
skill tied to this author or repo), or the reviewer hit its turn or budget cap before finishing.
**Fix:** the step's detail line lists every finding with severity; fix the named file. If the
verdict is missing entirely, re-run with a higher `--review-budget-usd` or `--max-turns`, or read
the raw `claude -p --output-format json` output for a `terminal_reason` other than `completed`.

## attest verify

**What it means:** `node scripts/attest.mjs verify` failed — the attestation this branch is
carrying does not hold up, so the PR's `attested` CI check will be red. **Why it fires, and the fix
for each reason:**

### schema mismatch
`evals/gate-report.json.schema` is not `2`. The report was written by an older gate. Re-run
`npm run gate` (or `gate:all`) to regenerate it.

### not attested
The report's `attested` field is `false`. Either the agentic half didn't run, a case failed, or a
bypass was recorded. Read the report's `bypass` and `steps` fields for the real cause, then see the
matching reason below.

### agentic did not run
`agenticRan` is not `true` — this was a deterministic-only run (`gate:quick`, or `--no-agentic`).
Run the full gate: `npm run gate` (or detached, see the top of this file). A deterministic-only run
is never a merge gate.

### bypass recorded
The report carries a `bypass` reason (`SKILLS_GATE_SKIP_AGENTIC=1` with
`SKILLS_GATE_BYPASS_REASON` set). A bypass can be pushed but can never verify — that's the point.
Fix the underlying harness problem (see `claude plugin eval` above) and re-run for real.

### skillsDigest mismatch
The recomputed hash over `git ls-files -s -- skills evals` doesn't match the one in the report — a
skill or eval file changed after the gate ran. Re-run `npm run gate` on the current tree and commit
the fresh report alongside the code change, not after it.

### harnessDigest mismatch
Same as above but for the harness paths (`scripts/gate.mjs`, `lint.config.json`, `gate.config.json`,
`package.json`, …). A harness change invalidates every prior attestation by design — re-run the
gate.

### commit not an ancestor of HEAD
The report's `commit` isn't in this branch's history — usually a rebase or a cherry-pick that left
the old report behind. Re-run the gate on the current `HEAD`.

### changed skill not covered
A skill differs from the merge base but doesn't appear in the report's `changed` list. Re-run the
gate with the right `--base` so it sees the diff (`node scripts/gate.mjs --base origin/main`), or
`--all` if the base can't be resolved.

### case not covered by the attestation
An eval case exists under `evals/<skill>/` that the attested report never ran — most often a case
added after the last gate run. Re-run the gate so every current case is attested.

### case below threshold
A case's `score` is under `gate.config.json.threshold`. Read the grader explanations in
`evals/attest/<case>.json` and fix the skill, not the threshold — `gate.config.json` changing in the
same PR as a `skills/` change is against house rules (it hides exactly this failure).

### case below minDelta
A case's `delta` (with-skill score minus without-skill score) is under `minDelta`. The skill isn't
proving its own value on this prompt — sharpen the case or the skill, don't lower `minDelta`.

### case partial
A case's `partial` flag is `true` — the run was cut short (a `--max-cost-usd` or turn-budget abort).
A partial run is never a pass regardless of the score it recorded before stopping. Increase the
budget or split the case, then re-run.

### case errored
An arm of a case carries a runtime `error`. Check whether it's a harness problem (see
`claude plugin eval` above) before assuming the skill is at fault.

### review not passed
The structural review's verdict for a changed skill isn't `pass`. See `structural review` above.

### attestation too old
`generatedAt` is more than `gate.config.json.maxAttestationAgeDays` in the past. Re-run the gate —
an old attestation on a PR that's been open a while is exactly what this catches.

### missing evidence
A case named in `eval.cases` has no matching file under `evals/attest/`. Re-run the gate so
`copyEvidence` writes it, and commit `evals/attest/` alongside the report.

### working tree dirty
`git status --porcelain` shows changes under `skills/ evals/ scripts/ lint.config.json
gate.config.json package.json` that aren't committed. A digest over uncommitted content isn't
verifiable by CI. Commit everything the gate just touched, then re-run if anything changed after
that.

### version not bumped
`skills/` changed since the merge base but `plugin.json.version` didn't move. Fix:
`node scripts/release.mjs bump patch` (or `minor`/`major` for a breaking or larger change).

### changelog not updated
`skills/` changed but `CHANGELOG.md`'s `## Unreleased` section gained no line in this diff. Add one
line, conventional-commit style, describing the change — `release.mjs bump` will roll it into the
dated section at release time.

## version bump

**What it means:** the `attested` CI check failed the "version not bumped" or "changelog not
updated" reason above. **Fix:** `node scripts/release.mjs bump <patch|minor|major>` — see that
section under `attest verify` for which level.

## gh pr checks

**What it means:** you're deciding whether a PR is safe to merge. **Never read `gh pr checks`'s
exit code** — it exits `0` both when every check passed *and* when GitHub reports "no checks
reported", which is exactly the false-green a required check with no `on.paths` trigger is meant to
avoid. **Fix / correct usage:** run `gh pr checks --watch`, then read the printed conclusions
column, not `$?`. A PR is mergeable only when `deterministic` and `attested` both show `pass` by
name — absence of a line for either is a reason to wait, not a reason to merge.
