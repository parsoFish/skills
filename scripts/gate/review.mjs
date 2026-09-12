// Headless structural review of one changed skill: a bounded, read-only `claude -p` call with a
// JSON-schema verdict. Parsing is pure and separately testable from the process spawn.
import { spawnSync } from 'node:child_process';

// Keep the headless reviewer lean: no user settings, skills or plugins from this machine leak in.
const LEAN_FLAGS = (process.env.SKILLS_GATE_LEAN_FLAGS ?? '--setting-sources project --disable-slash-commands --strict-mcp-config --no-session-persistence').split(' ').filter(Boolean);

export const REVIEW_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'finding'],
        properties: { severity: { enum: ['critical', 'major', 'minor'] }, finding: { type: 'string' }, file: { type: 'string' } },
      },
    },
  },
});

export function reviewPrompt(skill) {
  return `Review the skill at skills/${skill} (SKILL.md, references/, scripts/, assets/) against Claude Code skill-authoring best practice: third-person description that names trigger phrases and says when to use it; imperative body; progressive disclosure (SKILL.md under 500 lines, detail in references/); no dead relative links; scripts have tests; no author-specific or project-specific references; no angle brackets in frontmatter. Read only; do not edit. Return JSON: verdict "fail" only for critical or major findings.`;
}

/** Pure: parse the `claude -p --output-format json` stdout into a verdict + its reported cost.
 * `total_cost_usd` is what B16's ledger sources the review's dollar figure from. */
export function parseReviewOutput(stdout) {
  let payload;
  try {
    const line = stdout.trim().split('\n').filter(l => l.startsWith('{')).pop() ?? '{}';
    payload = JSON.parse(line);
  } catch {
    return { verdict: null, costUsd: 0 };
  }
  let verdict = payload.structured_output ?? (typeof payload.result === 'string' && payload.result.trim().startsWith('{') ? JSON.parse(payload.result) : payload.result);
  if (payload.terminal_reason && payload.terminal_reason !== 'completed' && !verdict?.verdict) {
    verdict = { verdict: 'fail', findings: [{ severity: 'critical', finding: `review did not complete: ${payload.terminal_reason}` }] };
  }
  return { verdict: verdict ?? null, costUsd: payload.total_cost_usd ?? 0 };
}

/** Run the structural review for one skill. `run` is injected (defaults to spawnSync against the
 * real `claude` binary) so callers can stub the process boundary in tests. */
export function runStructuralReview(root, skill, config, run = spawnSync) {
  const r = run('claude', [
    '-p', reviewPrompt(skill),
    '--output-format', 'json',
    '--json-schema', REVIEW_SCHEMA,
    '--model', config.reviewModel,
    '--allowedTools', 'Read', 'Glob', 'Grep',
    '--max-turns', '25',
    '--max-budget-usd', String(config.reviewBudgetUsd),
    ...LEAN_FLAGS,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  const { verdict, costUsd } = parseReviewOutput((r.stdout ?? '') + (r.stderr ?? ''));
  const ok = r.status === 0 && verdict?.verdict === 'pass';
  const findings = verdict?.findings ?? [];
  return {
    ok,
    exit: r.status ?? 1,
    verdict: verdict?.verdict ?? null,
    findings,
    costUsd,
    detail: verdict ? `${verdict.verdict}: ${findings.map(f => `[${f.severity}] ${f.finding}`).join(' | ') || 'no findings'}` : `no structured verdict (exit ${r.status})`,
  };
}
