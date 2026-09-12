# Flow: kit run → agent review → present + interview

| stage | who | input | output | guarantee |
|---|---|---|---|---|
| 0 kickoff | skill | checkout | run id, archetypes | no model call |
| 1 kit run | `arch.mjs`, no model | checkout + `docs/architecture/` (hand model, answers.json, fold-rules.json) | `docs/reference/*.json` + markdown pairs, rendered views, `_run/gaps.json` | deterministic: pinned tools, sorted output, no timestamps in bodies, read-only on source |
| 2 agent review | one reviewing agent, bounded turns | `_run/brief.md` only, plus source cited | written docs with evidence tiers, `_run/review.md`, `_run/interview.md`, gap classes | never invents; never edits `reference/`; kit gaps filed, not patched |
| 3 present | person | human-facing forms only | decisions in `answers.json` | no `.c4`/JSON shown; each question has evidence, options, default; answered questions not re-asked |

## Stage 1 in order
1. classify from manifests (package.json, go.mod, *.tf, manifest.json, pyproject).
2. extract per adapter → JSON + derived markdown:
   - components: import graph — offline `builtin` relative-import scanner (default) for TS/JS; opt-in `dependency-cruiser` (resolves tsconfig paths, needs `npx`, version pinned in `tools.json`) when fold-rules set `"engine": "dependency-cruiser"`; `extract-go.mjs`, an offline Go package scanner, for Go; `extract-terraform.mjs`, an offline module-graph scanner, for Terraform. Python: no extractor yet.
   - deps: manifests + lockfile; why inferred from production import sites; exit plan written.
   - delivery: workflow YAML → jobs, steps, gates. Required checks come from GitHub branch protection, which the kit does not fetch (no token, no network call); when unknown, `delivery.requiredChecks` is `null` and becomes a `kit` gap (`delivery-required-checks-unknown`) — answer it by setting `delivery.requiredChecks` in `answers.json`, not by re-running anything.
   - extension points: fold-rules `registries` globs → contract, discovery, invocation, isolation, installed.
   - api: openapi.yaml if present, else route literals grouped.
   - tests: `@seam`/`@layer` tags, else directory heuristics (marked ~).
   - ui anchors: routes + `data-*` attributes (UI kinds).
3. fold by rules; tests excluded by default.
4. seed or merge the hand model (first run only seeds; later runs never touch it).
5. drift: hand vs generated; runtime-tagged edges skipped; correction patch proposed.
6. render for humans: legend colours, light theme, the node cap [SKILL.md](../SKILL.md) states, edges under the threshold carry kind `minor` and are excluded, PNG at bounded scale; for agents: model json.
7. lint: `arch check` → fitness; size caps apply to written docs only.
8. checklist + gaps: fill CHECKLIST; emit gaps.json with class per gap; write `_run/brief.md` — one digest of everything above (kinds, components, drift, failing fitness/completeness rules with a fix recipe each, the required-view list, seeded model edges, the gap list) plus the exact command set stage 2 may run. This is the one file stage 2 reads before writing.

## Stage 2 contract
- Reads: `_run/brief.md` only, plus a source file to cite it, plus never anything under this
  skill's own `scripts/`. `components.json`, `drift.json`, `fitness.json`, `completeness.json` and
  `gaps.json` stay real agent-facing artefacts — CI's `arch drift`, `arch check`, and any external
  agent-map consumer still read them directly — but brief.md already carries what stage 2 needs
  from each, so stage 2 itself never opens them.
- Evidence tiers: `code` (cited path) · `inferred` (cited doc/ADR) · `GAP`. No fourth tier.
- Gap classes: kit / project / human.
- Interview question: finding · evidence · options (2–4) · default if unanswered · files that change.
- Exit: bloat rules pass, reference/ untouched, every gap classified, confidence per file.

## Audience rule
| artifact | agent form | human form |
|---|---|---|
| model | `.c4`, `model.json` | rendered views + captions |
| drift | `drift.json` | `drift.md`: three short tables, verdict first |
| tables | JSON | markdown, red rows first, one-line meaning |
| flows (pipeline, journey, signals, secrets, loop) | mermaid source | rendered mermaid where the host renders it, else PNG |
| gaps | `gaps.json` | `interview.md` + project list in `review.md` |
