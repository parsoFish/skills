# Flow: kit run → agent review → present + interview

| stage | who | input | output | guarantee |
|---|---|---|---|---|
| 0 kickoff | skill | checkout | run id, archetypes | no model call |
| 1 kit run | `arch.mjs`, no model | checkout + `docs/architecture/` (hand model, answers.yaml, fold-rules.json) | `docs/reference/*.json` + markdown pairs, rendered views, `_run/gaps.json` | deterministic: pinned tools, sorted output, no timestamps in bodies, read-only on source |
| 2 agent review | one reviewing agent, bounded turns | agent-facing forms only | written docs with evidence tiers, `_run/review.md`, `_run/interview.md`, gap classes | never invents; never edits `reference/`; kit gaps filed, not patched |
| 3 present | person | human-facing forms only | decisions in `answers.yaml` | no `.c4`/JSON shown; each question has evidence, options, default; answered questions not re-asked |

## Stage 1 in order
1. classify from manifests (package.json, go.mod, *.tf, manifest.json, pyproject).
2. extract per adapter → JSON + derived markdown:
   - components: import graph (dependency-cruiser for TS/JS; `go list -json` for Go; `terraform-config-inspect` for HCL; pydeps for Python) — implemented for TS/JS.
   - deps: manifests + lockfile; why inferred from production import sites; exit plan written.
   - delivery: workflow YAML → jobs, steps, gates; `--github` adds required checks when a token exists.
   - extension points: fold-rules `registries` globs → contract, discovery, invocation, isolation, installed.
   - api: openapi.yaml if present, else route literals grouped.
   - tests: `@seam`/`@layer` tags, else directory heuristics (marked ~).
   - jobs: job definitions / make targets (pipeline kinds).
   - ui anchors: routes + `data-*` attributes (UI kinds).
3. fold by rules; tests excluded by default.
4. seed or merge the hand model (first run only seeds; later runs never touch it).
5. drift: hand vs generated; runtime-tagged edges skipped; correction patch proposed.
6. render for humans: legend colours, light theme, ≤ 15 nodes per view, edges under the threshold carry kind `minor` and are excluded, PNG at bounded scale; for agents: model json.
7. lint: `arch check` → fitness; size caps apply to written docs only.
8. checklist + gaps: fill CHECKLIST; emit gaps.json with class per gap.

## Stage 2 contract
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
