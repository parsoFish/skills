<!-- gate-report -->
# Gate report — PASS — not attested (deterministic only, or schema 1)

| field | value |
| --- | --- |
| skillsDigest | `—` |
| commit | `—` |
| generatedAt | — |
| claudeVersion | — |
| pluginVersion | — |
| total cost | — |
| total duration | — |

## Deterministic steps

| step | verdict | detail |
| --- | --- | --- |
| lint | ok | skills lint: ok |
| tests | ok | — |
| plugin validate --strict | ok | ✔ Validation passed |
| skill-creator quick_validate architecture | ok | Skill is valid! |
| eval case with Skill grader architecture | ok | — |
| claude plugin eval (3 cases) | ok | document-a-terraform-repo 1 Δ1 · document-a-ts-monorepo 1 Δ1 · drift-catches-a-new-edge 1 Δ0.5 |
| structural review architecture | ok | pass: no findings |

## Eval cases (threshold 0.8, minDelta —)

| case | Δ | score | without | turns | cost | duration | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| document-a-terraform-repo | 1 | 1 | — | — | — | — | PASS |
| document-a-ts-monorepo | 1 | 1 | — | — | — | — | PASS |
| drift-catches-a-new-edge | 0.5 | 1 | — | — | — | — | PASS |

## Graders

### document-a-terraform-repo

| grader | type | with | without | explanation |
| --- | --- | --- | --- | --- |
| infra-generated | file_exists | pass | fail | docs/reference/infra.md exists as expected |
| module-names-recorded | regex | pass | fail | matched network[\s\S]*app\|app[\s\S]*network |
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
| drift-file-exists | file_exists | pass | fail | docs/reference/drift.md exists as expected |
| drift-mentioned | regex | pass | pass | matched drift\|undeclared |
| skill-fired | tool_used | pass | — | Skill called 1x (expected 1..∞) |

## Structural review

| skill | verdict | findings | cost |
| --- | --- | --- | --- |
| architecture | pass | none | — |

## Re-run

```
setsid nohup node scripts/gate.mjs --all --force > /tmp/gate.log 2>&1 &
```

## Per-case reports

- `evals/results/document-a-terraform-repo.html` (not tracked; produced by the same run)
- `evals/results/document-a-ts-monorepo.html` (not tracked; produced by the same run)
- `evals/results/drift-catches-a-new-edge.html` (not tracked; produced by the same run)

## Recent ledger

```
_no ledger entries yet_
```
