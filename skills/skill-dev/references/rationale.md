# Why each step exists

`SKILL.md` gives the steps; this file gives the reason behind each one, so the order can be
defended rather than merely followed. Every entry records a failure mode that was observed when the
step was skipped.

## 1. Classify the change

A change to an existing skill is easy to treat as "just an edit" and rush past the frontmatter. The
common regression is a `description` that drifted from what the skill now does: the body is
correct, but the skill no longer fires on the phrases that matter, or fires on ones that do not.
Classifying first forces the frontmatter re-read.

## 2. Draft the frontmatter

`description` is the whole triggering mechanism. Nothing else in the file influences whether the
skill loads. A generic description either never fires or always fires; both are useless. Third
person matters because the text is injected into a system prompt, not read as a reply.

`name` must equal the folder because repository lint and plugin validators key on it; a mismatch
fails loudly and late. `<` and `>` in frontmatter break several YAML front-matter parsers and are
rejected outright by some lints.

Harness-specific fields (a tool allowlist tied to one product) baked into a skill make it stop
working in every other harness. The eval case's own settings are the right place to scope tools.

## 3. Write the body

The body loads into context every time the skill fires, so every line is a recurring cost.
Imperatives read as instructions; descriptive prose about what an agent "should" do reads as
commentary and gets skimmed. Progressive disclosure (detail in `references/`) means a reader who
never needs the detail never pays for it, while one who does gets it exactly where the step links
to it.

## 4. Add a script and its test in the same commit

A script without a sibling test is a script nobody has verified against what the skill's prose
claims. Repository test runners are usually wired to discover `scripts/**/*.test.mjs`, so a missing
test is invisible until the gate's coverage check names it. Landing both in one commit keeps the
history honest: no commit exists where the script is untested. Pure functions keep the test
trivial and the behaviour legible from the prose alone.

## 5. Add or update the eval case

Frontmatter and body are a claim about behaviour; only a real end-to-end run against a fixture
tests the claim. Getting the file shapes and grader choices right is its own craft, which is why
the step delegates to `eval-authoring`. The two-grader rule matters because a `tool_used` grader is
a with-only indicator: it proves the skill loaded and scores nothing under with/without ablation.
A case with only that grader looks perfect and proves nothing.

## 6. Run the deterministic checks

Lint, tests and strict validation are free and fast. An agentic eval run costs real money and tens
of minutes. Every mechanical mistake the fast checks would have caught (a name that does not match
its folder, a broken relative link, a missing test) is paid for twice if discovered by the gate.

## 7. Run the agentic gate and read the delta

The score alone is not the signal. A task an agent already does well without the skill scores high
in both arms and says nothing about whether the skill helped. The delta between the with-skill and
without-skill arms is the number that says the skill changed the outcome. A low delta usually
means the case is not discriminating and needs a sharper grader, not a lower threshold.

The gate's review step is a fresh-context structural read of the skill. Arguing with a finding
costs more than fixing it, and the finding is usually right about what a stranger will read.

## 8. Bump the version and record the change

A plugin repository keys its release off one manifest and expects one changelog line per change.
A gate that enforces "version bumped, changelog touched" rejects the PR regardless of the skill's
quality, so doing this before the PR saves a round trip.

## 9. Branch, attest, open the PR

Protected main branches reject direct commits. The gate's attestation, a record of exactly what
was validated tied to the commit, is the evidence a reviewer or required check looks for; it must
be committed as produced, because a hand-edited attestation is indistinguishable from a lie. The
gate's own report is a more trustworthy PR body than a hand-written summary because it was
generated from the run rather than from memory of it.
