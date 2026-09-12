# Interview question shape

Every question the review agent asks a person has exactly these parts. Questions are the only way a `human`-class gap leaves stage 2.

```
### Qn · <one-line title>   id: <stable-kebab-id>
Finding. <what the kit or review found, in one or two sentences, with numbers>
Evidence. <files, generated tables, ADRs>
Options. (a) … · (b) … · (c) …   (2–4; the first is the recommendation when there is one)
Default. <what happens if unanswered — a choice, or "stays a GAP in <file>">
Changes. <which files change when answered>
```

Rules
- One finding per question. A question that needs two answers is two questions.
- Options are concrete actions, never "let me know".
- The default must be safe to apply unattended.
- Answers are stored in `docs/architecture/answers.yaml` as `id: {answer, at, note}`; the next run re-asks only when the evidence for that id changed.
- Kit-class gaps never become questions; they are filed in `_run/kit-issues.md` with a repro.
