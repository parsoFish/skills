<!-- gate-report -->
# Gate report — PASS — attested

| field | value |
| --- | --- |
| skillsDigest | `d11a8a556e55` |
| commit | `941d5fa880703e14694bc9247e9f990269e0ab88` |
| generatedAt | 2026-09-18T01:44:13.577Z |
| claudeVersion | 2.1.275 |
| pluginVersion | 0.2.3 |
| total cost | $8.74 |
| total duration | 44.9 min |

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
| skill-creator quick_validate skill-dev | ok | Skill is valid! |
| eval case with Skill grader skill-dev | ok | — |

## Eval cases (threshold 0.8, minDelta 0.25)

| case | Δ | score | without | turns | cost | duration | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| document-a-terraform-repo | 1 | 1 | 0 | 90 | $1.86 | 10.5 min | PASS |
| document-a-ts-monorepo | 1 | 1 | 0 | 95 | $2.50 | 13.4 min | PASS |
| drift-catches-a-new-edge | 1 | 1 | 0 | 18 | $0.44 | 2.1 min | PASS |
| writes-a-case-for-changelog-line | 1 | 1 | 0 | 23 | $1.21 | 7.0 min | PASS |
| adds-a-csv-to-table-skill | 0.625 | 0.875 | 0.25 | 31 | $1.86 | 12.0 min | PASS |

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

### adds-a-csv-to-table-skill

| grader | type | with | without | explanation |
| --- | --- | --- | --- | --- |
| eval-case-fixture-exists | file_exists | pass | fail | evals/csv-to-table/converts-a-simple-csv/fixture.sh exists as expected |
| eval-case-yaml-exists | file_exists | pass | fail | evals/csv-to-table/converts-a-simple-csv/case.yaml exists as expected |
| script-test-quality | llm | pass | pass | judge votes: PASS PASS PASS |
| skill-fired | tool_used | pass | — | Skill called 2x (expected 1..∞) |
| skill-md-quality | llm | fail | fail | judge votes: FAIL FAIL FAIL |

## Structural review

| skill | verdict | findings | cost |
| --- | --- | --- | --- |
| architecture | pass | none | $0.60 |
| eval-authoring | pass | none | $0.19 |
| skill-dev | pass | none | $0.09 |

## Re-run

```
setsid nohup node scripts/gate.mjs --all --force > /tmp/gate.log 2>&1 &
```

## Per-case reports

- `evals/results/document-a-terraform-repo.html` (not tracked; produced by the same run)
- `evals/results/document-a-ts-monorepo.html` (not tracked; produced by the same run)
- `evals/results/drift-catches-a-new-edge.html` (not tracked; produced by the same run)
- `evals/results/writes-a-case-for-changelog-line.html` (not tracked; produced by the same run)
- `evals/results/adds-a-csv-to-table-skill.html` (not tracked; produced by the same run)

## Recent ledger

```
| 2026-09-17 | a4e229e | architecture+eval-authoring+skill-dev | 5 cases | $6.89 | 38.9 min | sonnet-5/haiku-4-5 | PASS (reused 5 eval results) |
| 2026-09-17 | 0997a56 | architecture+eval-authoring+skill-dev | 5 cases | $7.00 | 38.9 min | sonnet-5/haiku-4-5 | PASS (reused 5 eval results) |
| 2026-09-17 | 5bedb98 | architecture+eval-authoring+skill-dev | 5 cases | $7.58 | 40.6 min | sonnet-5/haiku-4-5 | PASS (reused 1 eval result) |
| 2026-09-18 | ed79f99 | architecture+eval-authoring+skill-dev | 5 cases | $7.61 | 40.6 min | sonnet-5/haiku-4-5 | PASS (reused 5 eval results) |
| 2026-09-18 | 941d5fa | architecture+eval-authoring+skill-dev | 5 cases | $8.74 | 44.9 min | sonnet-5/haiku-4-5 | PASS (reused 1 eval result) |
```
