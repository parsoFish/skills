#!/usr/bin/env node
// Local gate for skill changes. Every added or changed skill must pass, in order:
//   1 deterministic: skills lint · script tests · `claude plugin validate --strict` · skill-creator quick_validate · has an eval case with a Skill grader
//   2 agentic (spends money, bounded): `claude plugin eval` on the changed skills' cases, then a headless structural review with a structured verdict
// Usage: node scripts/gate.mjs [--base <ref>] [--all] [--no-agentic] [--no-review] [--max-cost-usd 5] [--json <path>]
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, mkdtempSync, symlinkSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = f => args.includes(f);
const flag = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

/** Pure: which skills do these changed paths touch? */
export function changedSkills(paths) {
  const out = new Set();
  for (const p of paths) { const m = p.match(/^(?:skills|evals)\/([^/]+)\//); if (m) out.add(m[1]); }
  return [...out].sort();
}

/** Pure: case names under evals/<skill>/ (claude plugin eval filters by case name, not by skill path). */
export function caseNames(root, skill) {
  const dir = join(root, 'evals', skill);
  return existsSync(dir) ? readdirSync(dir).filter(c => existsSync(join(dir, c, 'prompt.md')) || existsSync(join(dir, c, 'case.yaml'))).sort() : [];
}

/** Pure: does the eval dir hold at least one case with a `tool_used: Skill` grader? */
export function evalCoverage(root, skill) {
  const dir = join(root, 'evals', skill);
  if (!existsSync(dir)) return { ok: false, cases: 0, detail: `evals/${skill}/ missing` };
  const cases = readdirSync(dir).filter(c => existsSync(join(dir, c, 'prompt.md')) || existsSync(join(dir, c, 'case.yaml')));
  const fired = cases.filter(c => { const g = join(dir, c, 'graders'); return existsSync(g) && readdirSync(g).some(f => /type:\s*tool_used[\s\S]*tool:\s*Skill/.test(readFileSync(join(g, f), 'utf8'))); });
  return { ok: cases.length > 0 && fired.length > 0, cases: cases.length, detail: cases.length ? (fired.length ? '' : 'no case has a tool_used: Skill grader') : 'no cases' };
}

/** Pure: read a `claude plugin eval --json` result. */
export function readEvalResult(json, threshold = 0.8) {
  const score = json?.aggregates?.overallScore ?? json?.overallScore ?? null;
  const cases = (json?.cases ?? []).map(c => ({ name: c.name ?? c.id ?? '?', score: c.aggregates?.score ?? c.score ?? null, delta: c.aggregates?.delta ?? c.delta ?? null }));
  const ok = score !== null && score >= threshold;
  return { ok, score, threshold, cases };
}

/** Pure: content hash of the changed skills (skill dir + its evals), so a passing agentic result can be reused for identical content. */
export function contentHash(root, skills) {
  const h = createHash('sha256');
  const walk = d => { if (!existsSync(d)) return; for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else { h.update(p.slice(root.length)); h.update(readFileSync(p)); } } };
  for (const s of [...skills].sort()) { walk(join(root, 'skills', s)); walk(join(root, 'evals', s)); }
  return h.digest('hex');
}

export function cachedPass(reportPath, hash) {
  try { const r = JSON.parse(readFileSync(reportPath, 'utf8')); return r.ok === true && r.agenticRan === true && r.contentHash === hash ? r : null; } catch { return null; }
}

/** Pure: a run error that means the machine, not the skill, failed — surfaced with the remedy instead of a silent score 0. */
export function harnessProblem(json) {
  const errs = (json?.cases ?? []).flatMap(c => Object.values(c.arms ?? {}).flat()).map(r => r?.error).filter(Boolean);
  if (!errs.length) return '';
  const e = String(errs[0]);
  if (/cannot confine|no sandbox backend/i.test(e)) return 'no sandbox backend for Bash-granting evals — install bubblewrap and socat (Debian/Ubuntu/WSL: sudo apt-get install -y bubblewrap socat) and re-run';
  if (/keychain credential helpers|PATH directory/i.test(e)) return 'unreadable PATH entries block the sandbox — the gate already sanitises PATH; check SKILLS_GATE_REAL_HOME';
  if (/Docker .*credential store/i.test(e)) return 'Docker credential store symlinks block the sandbox — the gate already swaps HOME; check ~/.docker';
  if (/Not logged in/i.test(e)) return 'Claude is not logged in under the gate HOME — run `claude /login` and re-run';
  return `every run errored before the first turn: ${e.slice(0, 160)}`;
}

export function locateQuickValidate() {
  const home = process.env.HOME ?? '';
  const candidates = [
    join(home, '.claude/plugins/marketplaces/anthropic-agent-skills/skills/skill-creator/scripts/quick_validate.py'),
    ...(existsSync(join(home, '.claude/plugins/cache/claude-plugins-official')) ? readdirSync(join(home, '.claude/plugins/cache/claude-plugins-official')).filter(d => d.startsWith('skill-creator')).map(d => join(home, '.claude/plugins/cache/claude-plugins-official', d)).flatMap(d => readdirSync(d).map(v => join(d, v, 'skills/skill-creator/scripts/quick_validate.py'))) : []),
  ];
  return candidates.find(existsSync) ?? null;
}

// Keep the headless reviewer lean: no user settings, skills or plugins from this machine leak into the review.
const LEAN_FLAGS = (process.env.SKILLS_GATE_LEAN_FLAGS ?? '--setting-sources project --disable-slash-commands --strict-mcp-config --no-session-persistence').split(' ').filter(Boolean);

function sh(cmd, argv, opts = {}) { const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, ...opts }); return { status: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }; }

/** The eval's Bash sandbox refuses to start when PATH holds unreadable dirs (WSL Windows mounts, plugin bin dirs) or when the Docker credential store contains symlinks. Give it a clean environment. */
export function sandboxEnv(env = process.env, fsApi = { readable: d => { try { readdirSync(d); return statSync(d).isDirectory(); } catch { return false; } }, tmpHome: () => mkdtempSync(join(tmpdir(), 'gate-home-')), link: (t, p) => symlinkSync(t, p), copy: (a, b) => { try { copyFileSync(a, b); } catch {} } }) {
  const path = (env.PATH ?? '').split(':').filter(d => d && fsApi.readable(d)).join(':');
  // A throwaway HOME keeps Claude's auth (symlinked ~/.claude, copied ~/.claude.json) but hides ~/.docker, whose symlinks the sandbox rejects.
  const home = fsApi.tmpHome();
  if (env.HOME) { fsApi.link(join(env.HOME, '.claude'), join(home, '.claude')); fsApi.copy(join(env.HOME, '.claude.json'), join(home, '.claude.json')); }
  return { ...env, PATH: path, HOME: home, DOCKER_CONFIG: join(home, '.docker-none'), SKILLS_GATE_REAL_HOME: env.HOME ?? '' };
}

function main() {
  const report = { changed: [], steps: [], ok: true };
  const step = (name, ok, detail = '') => { report.steps.push({ name, ok, detail }); if (!ok) report.ok = false; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail.split('\n')[0] : ''}`); };

  let changed;
  if (has('--all')) changed = readdirSync(join(ROOT, 'skills'));
  else {
    const base = flag('--base', 'origin/main');
    const diff = sh('git', ['diff', '--name-only', `${base}...HEAD`]).out + sh('git', ['diff', '--name-only', 'HEAD']).out + sh('git', ['ls-files', '--others', '--exclude-standard']).out;
    changed = changedSkills(diff.split('\n').filter(Boolean));
  }
  report.changed = changed;
  if (!changed.length) { console.log('gate: no skill changed — nothing to validate'); return finish(report); }
  console.log(`gate: changed skills → ${changed.join(', ')}`);

  // 1 deterministic
  let r = sh('node', ['scripts/lint-skills.mjs']); step('lint', r.status === 0, r.out.trim());
  r = sh('npm', ['test', '--silent']); step('tests', r.status === 0, r.status ? r.out.split('\n').filter(l => /^not ok|# fail/.test(l)).join(' | ') : '');
  r = sh('claude', ['plugin', 'validate', '.', '--strict']); step('plugin validate --strict', r.status === 0, r.out.trim().split('\n').pop());
  const qv = locateQuickValidate();
  for (const s of changed) {
    if (!qv) { step(`skill-creator quick_validate ${s}`, false, 'skill-creator not installed (claude plugin install skill-creator) — required'); continue; }
    r = sh('python3', [qv, join(ROOT, 'skills', s)]); step(`skill-creator quick_validate ${s}`, r.status === 0, r.out.trim());
    const cov = evalCoverage(ROOT, s); step(`eval case with Skill grader ${s}`, cov.ok, cov.detail);
  }
  if (!report.ok) { console.log('gate: deterministic checks failed; agentic phase skipped'); return finish(report); }

  // 2 agentic
  report.contentHash = contentHash(ROOT, changed);
  const prior = has('--force') ? null : cachedPass(flag('--json', join(ROOT, 'evals', 'gate-report.json')), report.contentHash);
  if (prior) { step('agentic phase', true, `cached pass for identical content (score ${prior.eval?.score ?? '?'}); --force to re-run`); report.agenticRan = true; report.eval = prior.eval; report.review = prior.review; report.cached = true; return finish(report); }
  if (has('--no-agentic') || process.env.SKILLS_GATE_SKIP_AGENTIC === '1') { step('agentic phase', true, 'SKIPPED by flag — not acceptable for a merge'); report.agenticSkipped = true; return finish(report); }
  report.agenticRan = true;
  const cap = flag('--max-cost-usd', '5');
  const jsonPath = join(ROOT, 'evals', 'gate-eval.json');
  const evalModel = flag('--eval-model', 'claude-sonnet-5'); const judge = flag('--judge-model', 'claude-haiku-4-5');
  const argv = ['plugin', 'eval', '.', '--trust-plugin', '--scaffold', '--allow-tools', 'Bash', 'Write', 'Edit', '--json', jsonPath, '--threshold', '0.8', '--max-cost-usd', cap, '--no-publish', '--model', evalModel, '--judge-model', judge, ...changed.flatMap(s => caseNames(ROOT, s)).flatMap(c => ['--case', c])];
  r = sh('claude', argv, { env: sandboxEnv() });
  let ev = { ok: false, score: null };
  let harness = '';
  try { const j = JSON.parse(readFileSync(jsonPath, 'utf8')); ev = readEvalResult(j); harness = harnessProblem(j); } catch {}
  if (harness) { step(`claude plugin eval (${changed.join(', ')})`, false, `HARNESS: ${harness}`); report.eval = ev; report.harness = harness; return finish(report); }
  step(`claude plugin eval (${changed.join(', ')})`, r.status === 0 && ev.ok, `exit ${r.status} · score ${ev.score ?? '?'} · ${ev.cases?.map(c => `${c.name} ${c.score ?? '?'}${c.delta != null ? ' Δ' + c.delta : ''}`).join(', ') ?? ''}`);
  report.eval = ev;

  if (!has('--no-review')) for (const s of changed) {
    const schema = JSON.stringify({ type: 'object', required: ['verdict', 'findings'], properties: { verdict: { enum: ['pass', 'fail'] }, findings: { type: 'array', items: { type: 'object', required: ['severity', 'finding'], properties: { severity: { enum: ['critical', 'major', 'minor'] }, finding: { type: 'string' }, file: { type: 'string' } } } } } });
    const prompt = `Review the skill at skills/${s} (SKILL.md, references/, scripts/, assets/) against Claude Code skill-authoring best practice: third-person description that names trigger phrases and says when to use it; imperative body; progressive disclosure (SKILL.md under 500 lines, detail in references/); no dead relative links; scripts have tests; no author-specific or project-specific references; no angle brackets in frontmatter. Read only; do not edit. Return JSON: verdict "fail" only for critical or major findings.`;
    const reviewModel = flag('--review-model', 'claude-sonnet-5');
    r = sh('claude', ['-p', prompt, '--output-format', 'json', '--json-schema', schema, '--model', reviewModel, '--allowedTools', 'Read', 'Glob', 'Grep', '--max-turns', '25', '--max-budget-usd', flag('--review-budget-usd', '2'), ...(LEAN_FLAGS)]);
    let verdict = null; try { const j = JSON.parse(r.out.trim().split('\n').filter(l => l.startsWith('{')).pop() ?? '{}'); verdict = j.structured_output ?? (typeof j.result === 'string' && j.result.trim().startsWith('{') ? JSON.parse(j.result) : j.result); if (j.terminal_reason && j.terminal_reason !== 'completed' && !verdict?.verdict) verdict = { verdict: 'fail', findings: [{ severity: 'critical', finding: `review did not complete: ${j.terminal_reason}` }] }; } catch {}
    const ok = r.status === 0 && verdict?.verdict === 'pass';
    step(`structural review ${s}`, ok, verdict ? `${verdict.verdict}: ${(verdict.findings ?? []).map(f => `[${f.severity}] ${f.finding}`).join(' | ') || 'no findings'}` : `no structured verdict (exit ${r.status})`);
    report.review = { ...(report.review ?? {}), [s]: verdict };
  }
  return finish(report);
}

function finish(report) {
  const out = flag('--json', join(ROOT, 'evals', 'gate-report.json'));
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
  console.log(report.ok ? `gate: PASS (${report.changed.length} skill(s))` : 'gate: FAIL');
  process.exitCode = report.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
