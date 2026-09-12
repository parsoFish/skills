## Summary

<!-- What changed, and why. One or two sentences. -->

## Gate report

<!-- gate-report -->
Paste the contents of `evals/REPORT.md` below, or — simpler — open this PR with:

    gh pr create --fill --body-file evals/REPORT.md

which uses the generated report as the whole PR body. The `attested` CI check posts the same
file as a PR comment on every run, so the evidence stays visible even if this section is left blank.

## Checklist

- [ ] `npm run gate` passed locally and `evals/{gate-report.json,attest/*,REPORT.md}` are committed
- [ ] a change under `skills/` bumped `.claude-plugin/plugin.json`'s version and added a `CHANGELOG.md` line
- [ ] `gh pr checks --watch` was read for conclusions, not just exit code
