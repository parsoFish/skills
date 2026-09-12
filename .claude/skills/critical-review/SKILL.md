---
name: critical-review
description: Runs a fresh-context hostile review of a skill or of this repository and turns the findings into parallel implementation streams with disjoint file ownership. Use when the user asks for a critical review, a fresh pair of eyes, a hostile review, or wants ranked findings split into parallel streams before implementation.
---

# Critical review

A review only finds real problems if the reviewer has no stake in the work looking good and no
memory of the reasoning that produced it. Every step below exists to protect that.

## 1. Write the brief

State the exact scope (a skill, a set of files, or the whole repo) and give it **three named
lenses** to look through — pick lenses that actually fit the scope (for example: correctness
against the repository's own stated rules, generic best-practice alignment, and whether the
result would still make sense to a stranger with none of this session's context). Require, in
writing: "cite file:line for every finding" and "a finding without a repro is an opinion." A
brief without both of those produces agreement, not verification.

## 2. Spawn one fresh-context reviewer per lens

Read-only tools only; no shared context with this session and no access to the reasoning that
produced the work. Use the strongest model available for this (an opus-tier agent) — a reviewer
that's cheaper than the thing it's reviewing tends to rubber-stamp it. Run the lenses in parallel,
not sequentially; a reviewer that's seen another lens's findings anchors on them.

## 3. Rank and prune

Collect the findings, rank them by actual value (a real defect beats a style nit; a reproducible
one beats a plausible-sounding one), and **drop anything unreproducible** — an opinion is not a
finding just because a capable model wrote it down confidently. Watch the refute rate on any
finding you do act on: if a later, more hostile pass overturns a large share of what an earlier
pass approved, that's a signal to review harder next time, not a coincidence to ignore.

## 4. Split into streams with disjoint file ownership

Turn the surviving findings into parallel implementation streams, each with a file ownership list
that does not overlap any other stream's. One sonnet-tier agent per stream — no forks, no nested
subagents writing into the same files concurrently; that's how two agents silently clobber each
other's edits. Give each stream the same binding contract (what it owns, what it must not touch,
how to hand off) so they can run at the same time without coordinating live.

## 5. Integrate, re-gate, record the refute rate

Once every stream reports done, integrate the changes yourself (resolve any real overlaps,
reconcile anything the disjoint-ownership split didn't anticipate), run the gate on the result
(`gate-run` skill), and record — even informally — how many of the original findings held up
under implementation versus turned out to be wrong or unreproducible once someone tried to act on
them. That number is what makes the next review's brief better than this one's.
