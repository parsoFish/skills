<!-- gate-report -->
# Gate report — PASS — attested

| field | value |
| --- | --- |
| skillsDigest | `031a58662515` |
| commit | `14381dc836c5b2b8bedf00b78a54dd6752c177c7` |
| generatedAt | 2026-11-14T14:22:52.529Z |
| claudeVersion | 2.1.269 |
| pluginVersion | 0.2.4 |
| total cost | $10.09 |
| total duration | 52.2 min |

## Deterministic steps

| step | verdict | detail |
| --- | --- | --- |
| lint | ok | skills lint: ok |
| tests | ok | — |
| plugin validate --strict | ok | ✔ Validation passed |
| skill-creator quick_validate architecture | ok | Skill is valid! |
| eval case with Skill grader architecture | ok | — |
| skill-creator quick_validate eval-authoring | ok | Skill is valid! |
| eval case with Skill grader eval-authoring | ok | — |
| skill-creator quick_validate redesign | ok | Skill is valid! |
| eval case with Skill grader redesign | ok | — |
| skill-creator quick_validate skill-dev | ok | Skill is valid! |
| eval case with Skill grader skill-dev | ok | — |

## Eval cases (threshold 0.8, minDelta 0.25)

| case | Δ | score | without | turns | cost | duration | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| document-a-terraform-repo | 1 | 1 | 0 | 79 | $1.88 | 10.4 min | PASS |
| document-a-ts-monorepo | 1 | 1 | 0 | 95 | $2.50 | 13.4 min | PASS |
| drift-catches-a-new-edge | 1 | 1 | 0 | 14 | $0.40 | 2.1 min | PASS |
| writes-a-case-for-changelog-line | 1 | 1 | 0 | 24 | $1.19 | 7.7 min | PASS |
| starts-a-redesign-with-a-prd-round | 0.8571428571428572 | 0.8571428571428572 | 0 | 37 | $1.49 | 7.8 min | PASS |
| adds-a-csv-to-table-skill | 0.6 | 1 | 0.4 | 29 | $1.92 | 10.8 min | PASS |

## Graders

### document-a-terraform-repo

| grader | type | with | without | explanation |
| --- | --- | --- | --- | --- |
| infra-generated | file_exists | pass | fail | docs/reference/infra.md exists as expected |
| module-names-recorded | regex | pass | fail | matched (^\\|\s*app\s*\\|[\s\S]*^\\|\s*network\s*\\|)\|(^\\|\s*network\s*\\|[\s\S]*^\\|\s*app\s*\\|) |
| overview-not-invented | llm | pass | fail | judge votes: PASS PASS PASS |
| skill-fired | tool_used | pass | — | Skill called 1x (expected 1..∞) |

### document-a-ts-monorepo

| grader | type | with | without | explanation |
| --- | --- | --- | --- | --- |
| components-generated | file_exists | pass | fail | docs/reference/components.md exists as expected |
| cycle-detected | regex | pass | fail | matched core.*web\|web.*core |
| deps-ledger-truth | llm | pass | fail | judge votes: PASS PASS PASS |
| overview-not-invented | llm | pass | fail | judge votes: PASS PASS PASS |
| skill-fired | tool_used | pass | — | Skill called 1x (expected 1..∞) |

### drift-catches-a-new-edge

| grader | type | with | without | explanation |
| --- | --- | --- | --- | --- |
| drift-edge-recorded | regex | pass | fail | matched util |
| drift-file-exists | file_exists | pass | fail | docs/reference/drift.md exists as expected |
| drift-mentioned | llm | pass | fail | judge votes: PASS PASS PASS |
| skill-fired | tool_used | pass | — | Skill called 1x (expected 1..∞) |

### writes-a-case-for-changelog-line

| grader | type | with | without | explanation |
| --- | --- | --- | --- | --- |
| case-yaml-shape | llm | pass | fail | judge votes: PASS PASS PASS |
| fixture-shape | llm | pass | fail | judge votes: PASS PASS PASS |
| skill-fired | tool_used | pass | — | Skill called 1x (expected 1..∞) |

### starts-a-redesign-with-a-prd-round

| grader | type | with | without | explanation |
| --- | --- | --- | --- | --- |
| decisions-file | file_exists | pass | fail | redesign/DECISIONS.md exists as expected |
| final-message | llm | fail | fail | judge votes: FAIL FAIL PASS |
| first-round-built | file_exists | pass | fail | redesign/reviews/01-prd-1/index.html exists as expected |
| prd-content | llm | pass | fail | judge votes: PASS PASS PASS — note: long file (8278 chars); llm judges are noisy on long inputs, prefer a regex grader for large artifacts |
| skill-fired | tool_used | pass | — | Skill called 1x (expected 1..∞) |
| state-file | file_exists | pass | fail | redesign/STATE.md exists as expected |

### adds-a-csv-to-table-skill

| grader | type | with | without | explanation |
| --- | --- | --- | --- | --- |
| description-names-trigger | regex | pass | pass | matched ^description:.*\bU[s]e w[h]en\b |
| eval-case-fixture-exists | file_exists | pass | fail | evals/csv-to-table/converts-a-simple-csv/fixture.sh exists as expected |
| eval-case-yaml-exists | file_exists | pass | fail | evals/csv-to-table/converts-a-simple-csv/case.yaml exists as expected |
| script-test-quality | llm | pass | pass | judge votes: PASS PASS PASS |
| skill-fired | tool_used | pass | — | Skill called 1x (expected 1..∞) |
| when-not-to-use-section | regex | pass | fail | matched ^## W[h]en n[o]t t[o] u[s]e\s*$ |

## Structural review

| skill | verdict | findings | cost |
| --- | --- | --- | --- |
| architecture | pass | none | $0.35 |
| eval-authoring | pass | none | $0.12 |
| redesign | pass | none | $0.14 |
| skill-dev | pass | [minor] skills/skill-dev has no scripts/ or assets/ dirs — expected, since this is a meta-skill about editing other skills' SKILL.md/body, not a tool-driven skill; not a defect.; [minor] Step 5 and the 'When not to use' section depend on a sibling skill (eval-authoring) and on the host repo having a lint/eval/gate; this is explicitly guarded by a 'When not to use' clause, so it degrades gracefully rather than breaking, but it does mean this skill is most useful inside a repo shaped like this one. | $0.11 |

## Re-run

```
setsid nohup node scripts/gate.mjs --all --force > /tmp/gate.log 2>&1 &
```

## Per-case reports

- `evals/results/document-a-terraform-repo.html` (not tracked; produced by the same run)
- `evals/results/document-a-ts-monorepo.html` (not tracked; produced by the same run)
- `evals/results/drift-catches-a-new-edge.html` (not tracked; produced by the same run)
- `evals/results/writes-a-case-for-changelog-line.html` (not tracked; produced by the same run)
- `evals/results/starts-a-redesign-with-a-prd-round.html` (not tracked; produced by the same run)
- `evals/results/adds-a-csv-to-table-skill.html` (not tracked; produced by the same run)

## Recent ledger

```
| 2026-09-17 | 0997a56 | architecture+eval-authoring+skill-dev | 5 cases | $7.00 | 38.9 min | sonnet-5/haiku-4-5 | PASS (reused 5 eval results) |
| 2026-09-17 | 5bedb98 | architecture+eval-authoring+skill-dev | 5 cases | $7.58 | 40.6 min | sonnet-5/haiku-4-5 | PASS (reused 1 eval result) |
| 2026-09-18 | ed79f99 | architecture+eval-authoring+skill-dev | 5 cases | $7.61 | 40.6 min | sonnet-5/haiku-4-5 | PASS (reused 5 eval results) |
| 2026-09-18 | 941d5fa | architecture+eval-authoring+skill-dev | 5 cases | $8.74 | 44.9 min | sonnet-5/haiku-4-5 | PASS (reused 1 eval result) |
| 2026-11-14 | 14381dc | architecture+eval-authoring+redesign+skill-dev | 6 cases | $10.09 | 52.2 min | sonnet-5/haiku-4-5 | PASS (reused 5 eval results) |
```
