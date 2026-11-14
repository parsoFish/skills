# The hand-off packet

Stage 5 ends with a packet the build can run from without the planning workspace. A build that follows good specs asks nothing for days and then stalls at the end, where the plan meets the real repository, the real machines and the person's own shell. Every part below removes one of those stalls.

The packet lives at `handoff/` (or `<track>/handoff/`) and is reviewed on the stage-5 lock page.

## 1. Brief

`handoff/brief.md`, the first thing the build session reads. Sections, in order:

1. **Read first**: the documents in the order to read them, all inside the build repository.
2. **Rules for the whole build**: the repository's own rules, the pace decision (no stops, or the named checkpoints), what needs the person.
3. **Log and resumption**: the build keeps `docs/build-log.md`; a line when a chunk or step starts and ends; every resumption starts by reading the log and the plan. Compaction summaries copy an "operating facts" header verbatim (which process runs where, on which port, from which folder).
4. **What to do when stopped**: at a usage limit, a killed process, a refused command: what to park, what to retry, who re-runs the last test run before anything ships.
5. **End report**: what the build writes when done (what was proven, what was not, cost if measured).

Check the brief against the plan: list every place the brief overrides the plan and resolve each as a decision.

## 2. Start checklist, dry-run

`handoff/start.md`: the person's acts and the build's first acts, each a command with its expected observable result and an "already done" check so it can run twice. Before the lock, dry-run it against the real target: the repository's hooks, remotes, authentication, the folder moves. A plan that assumes a push the hooks refuse fails on its first line.

## 3. Document manifest

`handoff/manifest.json`: an array of `{ "from", "to", "sha256", "owner" }`, one entry per document that moves into a build repository, where `owner` names who may change it after the copy (the build's own loop, by a decision). Copies are byte-identical at the first commit and change only through the build repository afterwards.

## 4. Self-contained destination

The copied documents must read without the planning workspace. Either inline the reason where a document says "decision N", or copy a frozen `DECISIONS.md` beside them and point the references at it. Studies in `research/` that a spec cites are copied too.

## 5. Environment facts

`handoff/environment.md`: what the build host and the person's own shell do differently from what the documents assume. Path differences between shells, which program a command name resolves to in each, how each shell treats quotes and backslashes, memory ceilings, usage limits, what holds a port. Collected from the spikes and from `CLAUDE.md`. A shell trap that is not written down is relearned on every context reset.

## 6. Test matrix

For each capability that depends on where it runs (a shell on a machine, a file placed on a machine, a session kind), one test row per kind of machine or reach, marked "the build can run it" or "the person's pass". A plan that tests one kind of machine finds its bugs on the others at the switch.

## 7. The end, rehearsed

`handoff/end.md`: the switch from the deployed system to the new one as command-exact steps with the role, port, folder and process each touches, and the observable after each. The build rehearses it once on a throwaway copy (real run folder, real process supervisor, real release screen) before declaring itself done. What is not rehearsed blocks the real switch: an old process still holding a port, a release check reading the wrong branch.

## 8. Carry-over by mechanism

The plan lists what moves from the old system by data store. The packet lists it by mechanism: every read and write the old system does, every startup item, launcher, firewall rule, notification channel, serve address and port. Each row has an owner, a step and a check. Listing by data store misses what is not a store, such as a notification channel.

## 9. Unproven list with owners

Every "not verified" from `research/` and every spec test the build cannot run, with an owner (the build or the person), the step at which it is checked, and what the build did to shrink the risk.

## 10. The lock page

The stage-5 lock page shows the plan drawn as lanes, the start checklist and the end runbook in the second person (`blocks.toYou` fails the build if a line still names the person), the dry-run's result, the unproven list folded, one row per document and packet part, and two asks: pace and lock.
