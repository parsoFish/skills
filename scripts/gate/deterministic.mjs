// The deterministic half of the gate: skills lint, script tests, `claude plugin validate --strict`,
// skill-creator's own validator per changed skill, and eval coverage per changed skill. No agentic
// spend; every step must be able to run offline given the tools are installed.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evalCoverage } from './eval.mjs';

export function locateQuickValidate() {
  const home = process.env.HOME ?? '';
  const marketplaceCache = join(home, '.claude/plugins/cache/claude-plugins-official');
  const candidates = [
    join(home, '.claude/plugins/marketplaces/anthropic-agent-skills/skills/skill-creator/scripts/quick_validate.py'),
    ...(existsSync(marketplaceCache)
      ? readdirSync(marketplaceCache).filter(d => d.startsWith('skill-creator')).map(d => join(marketplaceCache, d)).flatMap(d => readdirSync(d).map(v => join(d, v, 'skills/skill-creator/scripts/quick_validate.py')))
      : []),
  ];
  return candidates.find(existsSync) ?? null;
}

/** Run the deterministic checks and return { ok, steps }. `sh(cmd, argv, opts)` is injected so this
 * is testable without actually spawning `claude`/`python3`. Per-skill checks (quick_validate, eval
 * coverage) only run for `scope.skills` — the loop is simply empty for a harness-only change. */
export function runDeterministicChecks({ root, scope, sh }) {
  const steps = [];
  let ok = true;
  const step = (name, stepOk, detail = '') => { steps.push({ name, ok: stepOk, detail }); if (!stepOk) ok = false; };

  let r = sh('node', ['scripts/lint-skills.mjs']);
  step('lint', r.status === 0, r.out.trim());

  r = sh('npm', ['test', '--silent']);
  step('tests', r.status === 0, r.status ? r.out.split('\n').filter(l => /^not ok|# fail/.test(l)).join(' | ') : '');

  r = sh('claude', ['plugin', 'validate', '.', '--strict']);
  step('plugin validate --strict', r.status === 0, r.out.trim().split('\n').pop());

  const qv = locateQuickValidate();
  for (const s of scope.skills) {
    if (!qv) {
      step(`skill-creator quick_validate ${s}`, false, 'skill-creator not installed (claude plugin install skill-creator) — required');
      continue;
    }
    r = sh('python3', [qv, join(root, 'skills', s)]);
    step(`skill-creator quick_validate ${s}`, r.status === 0, r.out.trim());
    const cov = evalCoverage(root, s);
    step(`eval case with Skill grader ${s}`, cov.ok, cov.detail);
  }

  return { ok, steps };
}
