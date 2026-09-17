<!-- gate-report -->
# Gate report — PASS — attested

| field | value |
| --- | --- |
| skillsDigest | `0f70ddebfd2e` |
| commit | `5bedb9898315c0cd2615d45ae06b0b0c1c8b5d56` |
| generatedAt | 2026-09-17T22:19:46.937Z |
| claudeVersion | 2.1.274 |
| pluginVersion | 0.2.2 |
| total cost | $7.58 |
| total duration | 40.6 min |

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
| document-a-terraform-repo | 1 | 1 | 0 | 69 | $1.94 | 13.0 min | PASS |
| document-a-ts-monorepo | 1 | 1 | 0 | 130 | $3.28 | 17.7 min | PASS |
| drift-catches-a-new-edge | 1 | 1 | 0 | 14 | $0.36 | 1.8 min | PASS |
| writes-a-case-for-changelog-line | 0.33333333333333337 | 1 | 0.6666666666666666 | 19 | $0.50 | 3.2 min | PASS |
| adds-a-csv-to-table-skill | 0.2857142857142857 | 0.8571428571428571 | 0.5714285714285714 | 32 | $0.96 | 4.8 min | PASS |

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
| case-yaml-exists | file_exists | pass | pass | evals/changelog-line/adds-one-line/case.yaml exists as expected |
| case-yaml-shape | llm | pass | fail | judge votes: PASS PASS PASS |
| fixture-exists | file_exists | pass | pass | evals/changelog-line/adds-one-line/fixture.sh exists as expected |
| fixture-shape | llm | pass | fail | judge votes: PASS PASS PASS |
| produced-skill-fired-grader | file_exists | pass | pass | evals/changelog-line/adds-one-line/graders/skill-fired.md exists as expected |
| prompt-exists | file_exists | pass | pass | evals/changelog-line/adds-one-line/prompt.md exists as expected |
| skill-fired | tool_used | pass | — | Skill called 1x (expected 1..∞) |

### adds-a-csv-to-table-skill

| grader | type | with | without | explanation |
| --- | --- | --- | --- | --- |
| eval-case-fixture-exists | file_exists | pass | fail | evals/csv-to-table/converts-a-simple-csv/fixture.sh exists as expected |
| eval-case-skill-grader-exists | file_exists | pass | pass | evals/csv-to-table/converts-a-simple-csv/graders/skill-fired.md exists as expected |
| eval-case-yaml-exists | file_exists | pass | fail | evals/csv-to-table/converts-a-simple-csv/case.yaml exists as expected |
| script-test-exists | file_exists | pass | pass | skills/csv-to-table/scripts/convert.test.mjs exists as expected |
| script-test-quality | llm | pass | pass | judge votes: PASS PASS PASS |
| skill-fired | tool_used | pass | — | Skill called 1x (expected 1..∞) |
| skill-md-exists | file_exists | pass | pass | skills/csv-to-table/SKILL.md exists as expected |
| skill-md-quality | llm | fail | fail | judge votes: FAIL FAIL FAIL |

## Structural review

| skill | verdict | findings | cost |
| --- | --- | --- | --- |
| architecture | pass | none | $0.28 |
| eval-authoring | pass | none | $0.13 |
| skill-dev | pass | [minor] SKILL.md references `references/rationale.md` only as backticked plain text (line 10), not as a markdown link, unlike every other skill in the repo (architecture, eval-authoring all use `[references/x.md](references/x.md)` links). Not a dead link since there's no link syntax to break, but it's inconsistent with the repo's progressive-disclosure linking convention and slightly hurts navigability. | $0.12 |

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
| 2026-09-12 | 8a56568 | architecture+eval-authoring+skill-dev | 5 cases | $6.32 | 33.5 min | sonnet-5/haiku-4-5 | PASS (reused 5 eval results) |
| 2026-09-17 | 754e010 | architecture+eval-authoring+skill-dev | 5 cases | $7.03 | 38.9 min | sonnet-5/haiku-4-5 | PASS (reused 2 eval results) |
| 2026-09-17 | a4e229e | architecture+eval-authoring+skill-dev | 5 cases | $6.89 | 38.9 min | sonnet-5/haiku-4-5 | PASS (reused 5 eval results) |
| 2026-09-17 | 0997a56 | architecture+eval-authoring+skill-dev | 5 cases | $7.00 | 38.9 min | sonnet-5/haiku-4-5 | PASS (reused 5 eval results) |
| 2026-09-17 | 5bedb98 | architecture+eval-authoring+skill-dev | 5 cases | $7.58 | 40.6 min | sonnet-5/haiku-4-5 | PASS (reused 1 eval result) |
```
