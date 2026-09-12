---
name: gate-run
description: Runs this repository's agentic gate (npm run gate) safely on this memory-constrained host and reports the verdict, per-case delta, cost, and duration. Use when the user asks to run the gate, kick off npm run gate, validate a skill change end to end, or check whether a change is ready to merge.
---

# Gate run

`npm run gate` spends real money and this host's Claude Code low-memory guard kills a foregrounded
long-running task, so never run it directly. Follow these steps in order.

## 1. Confirm the tree is clean

`git status --porcelain -- skills evals scripts lint.config.json gate.config.json package.json`
must be empty. The attestation the gate writes is only trustworthy against a clean, committed
tree — commit or stash first if anything shows.

## 2. Launch detached

```
setsid nohup node scripts/gate.mjs --all --force > /tmp/gate-$(date +%s).log 2>&1 &
```

Never run `node scripts/gate.mjs` in the foreground and never omit `setsid nohup`. Note the log
path it printed (or the PID) before moving on.

## 3. Poll, never block

Poll the log file every 15–30 seconds for one of the verdict lines (`gate: PASS`,
`gate: DETERMINISTIC ONLY`, `gate: FAIL <step>`). Do not use a single long blocking wait — check,
report progress if asked, check again. A full agentic run can take 20–30 minutes.

## 4. On a `HARNESS:` line, fix and restart

A line starting `HARNESS:` means the machine failed, not the skill — no sandbox backend, PATH
poisoning, Docker credential-store symlinks, or not logged in. Apply the matching remedy in
[docs/gate-runbook.md](../../../docs/gate-runbook.md) and go back to step 2. Do not report this as
a skill failure.

## 5. On PASS, commit the evidence

Once the log shows `gate: PASS (attested <digest>)`, commit the generated evidence as its own
commit:

```
git add evals/gate-report.json evals/attest evals/REPORT.md evals/ledger.md
git commit -m "chore(gate): attest <digest12>"
```

Use the actual 12-character digest from the verdict line, not a placeholder.

## 6. Report back

Tell the user: the verdict, each case's with/without score and delta (not just whether it
"passed"), the total cost, and the total duration. If it failed, name the exact step and point at
the runbook section rather than re-describing the error in your own words.
