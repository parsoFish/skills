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
- Answers are stored in `docs/architecture/answers.json` as `id: {answer, at, note}`; an answered id is never asked again.
- `{"answer": "n/a"}` (or `"not applicable"`, or `{"notApplicable": true}`) rules a gap out for good, for any class: the gap stays in `gaps.json` marked `accepted`, `project-changes.md` and `kit-issues.md` print `accepted: not applicable (answers.json, <date>) — <note>` instead of re-raising it, and its status is `accepted` rather than new/open/regressed.
- Kit-class gaps never become questions; they are filed in `_run/kit-issues.md` with a repro.
