// Pure helpers for reading and aggregating `claude plugin eval --json` results, plus the sandbox
// environment the CLI's Bash-granting evals need to start at all.
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, symlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Pure: case names under evals/<skill>/ (claude plugin eval filters by name glob, not by skill path). */
export function caseNames(root, skill) {
  const dir = join(root, 'evals', skill);
  return existsSync(dir) ? readdirSync(dir).filter(c => existsSync(join(dir, c, 'prompt.md')) || existsSync(join(dir, c, 'case.yaml'))).sort() : [];
}

/** Pure: does the eval dir hold at least one case with a `tool_used: Skill` grader? */
export function evalCoverage(root, skill) {
  const dir = join(root, 'evals', skill);
  if (!existsSync(dir)) return { ok: false, cases: 0, detail: `evals/${skill}/ missing` };
  const cases = readdirSync(dir).filter(c => existsSync(join(dir, c, 'prompt.md')) || existsSync(join(dir, c, 'case.yaml')));
  const fired = cases.filter(c => {
    const g = join(dir, c, 'graders');
    return existsSync(g) && readdirSync(g).some(f => /type:\s*tool_used[\s\S]*tool:\s*Skill/.test(readFileSync(join(g, f), 'utf8')));
  });
  return { ok: cases.length > 0 && fired.length > 0, cases: cases.length, detail: cases.length ? (fired.length ? '' : 'no case has a tool_used: Skill grader') : 'no cases' };
}

/** Pure: read one `claude plugin eval --json --case <name>` result (one case per invocation) and
 * decide whether it passes. A case passes only when score >= threshold AND delta >= minDelta AND
 * partial !== true AND no arm carries an error AND the with-arm did not skip a paid grader —
 * `tool_used: Skill` alone contributes nothing to score/delta under with-without ablation, so a case
 * with no other scored grader is structurally incapable of passing this. */
export function readEvalResult(json, { threshold, minDelta }) {
  const c = (json?.cases ?? [])[0];
  if (!c) {
    return { ok: false, score: null, scoreWithout: null, delta: null, partial: true, errors: ['no case in eval result'], skippedPaidGraders: false, turns: null, costUsd: json?.costUsd ?? null, durationSeconds: json?.durationSeconds ?? null };
  }
  const score = c.aggregates?.score ?? null;
  const scoreWithout = c.aggregates?.scoreWithout ?? null;
  const delta = c.aggregates?.delta ?? null;
  const withArm = (c.arms?.with ?? [])[0] ?? {};
  const allArms = [...(c.arms?.with ?? []), ...(c.arms?.without ?? [])];
  const errors = allArms.map(a => a?.error).filter(Boolean);
  const partial = json?.partial === true;
  const skippedPaidGraders = withArm.skippedPaidGraders === true;
  const ok = score !== null && score >= threshold && delta !== null && delta >= minDelta && !partial && errors.length === 0 && !skippedPaidGraders;
  return {
    ok, score, scoreWithout, delta, partial, errors, skippedPaidGraders,
    turns: withArm.turns ?? null,
    costUsd: json?.costUsd ?? null,
    durationSeconds: json?.durationSeconds ?? null,
  };
}

/** Pure: every case must pass; overall score = min case score. */
export function aggregateEvals(perCase) {
  if (!perCase.length) return { ok: false, score: null, cases: [] };
  const ok = perCase.every(c => c.ok && c.exit === 0);
  const score = Math.min(...perCase.map(c => c.score ?? 0));
  return {
    ok,
    score,
    cases: perCase.map(c => ({
      name: c.name, skill: c.skill, model: c.model, judge: c.judge, evidence: c.evidence ?? null,
      score: c.score, scoreWithout: c.scoreWithout, delta: c.delta, partial: c.partial,
      errors: c.errors, turns: c.turns, costUsd: c.costUsd, durationSeconds: c.durationSeconds, exit: c.exit,
    })),
  };
}

/** Pure: a run error that means the machine, not the skill, failed — surfaced with the remedy instead
 * of a silent score 0. */
export function harnessProblem(json) {
  const errs = (json?.cases ?? []).flatMap(c => Object.values(c.arms ?? {}).flat()).map(r => r?.error).filter(Boolean);
  if (!errs.length) return '';
  const e = String(errs[0]);
  if (/cannot confine|no sandbox backend/i.test(e)) return 'no sandbox backend for Bash-granting evals — install bubblewrap and socat (Debian/Ubuntu/WSL: sudo apt-get install -y bubblewrap socat) and re-run';
  if (/keychain credential helpers|PATH directory/i.test(e)) return 'unreadable PATH entries block the sandbox — the gate already sanitises PATH; check SKILLS_GATE_REAL_HOME';
  if (/Docker .*credential store/i.test(e)) return 'Docker credential store symlinks block the sandbox — the gate already swaps HOME; check ~/.docker';
  if (/Not logged in/i.test(e)) return 'Claude is not logged in under the gate HOME — run `claude /login` and re-run';
  if (/EACCES.*posix_spawn.*claude/i.test(e)) return 'the claude binary was replaced under the run (auto-update race) — re-run with --reuse-evals; the gate now disables the updater for its children';
  return `every run errored before the first turn: ${e.slice(0, 160)}`;
}

/** The eval's Bash sandbox refuses to start when PATH holds unreadable dirs (WSL Windows mounts,
 * plugin bin dirs) or when the Docker credential store contains symlinks. Give it a clean environment. */
export function sandboxEnv(env = process.env, fsApi = {
  readable: d => { try { readdirSync(d); return statSync(d).isDirectory(); } catch { return false; } },
  tmpHome: () => mkdtempSync(join(tmpdir(), 'gate-home-')),
  link: (t, p) => symlinkSync(t, p),
  copy: (a, b) => { try { copyFileSync(a, b); } catch { /* no ~/.claude.json to copy — auth stays absent */ } },
}) {
  const path = (env.PATH ?? '').split(':').filter(d => d && fsApi.readable(d)).join(':');
  // A throwaway HOME keeps Claude's auth (symlinked ~/.claude, copied ~/.claude.json) but hides
  // ~/.docker, whose symlinks the sandbox rejects.
  const home = fsApi.tmpHome();
  if (env.HOME) {
    fsApi.link(join(env.HOME, '.claude'), join(home, '.claude'));
    fsApi.copy(join(env.HOME, '.claude.json'), join(home, '.claude.json'));
  }
  // The auto-updater replaces the CLI binary in place; a case that spawns during the swap dies with
  // EACCES. Every child the gate starts runs with the updater off.
  return { ...env, PATH: path, HOME: home, DOCKER_CONFIG: join(home, '.docker-none'), SKILLS_GATE_REAL_HOME: env.HOME ?? '', DISABLE_AUTOUPDATER: '1' };
}

/** Pure: a stored `claude plugin eval` result may stand in for a fresh run only when it started after
 * the last commit that touched the skill it tests (epoch seconds); no change time means never. */
export function canReuseEval(json, lastChangeEpoch) {
  if (!json || !json.startedAt || lastChangeEpoch == null) return false;
  const started = Date.parse(json.startedAt);
  return Number.isFinite(started) && started / 1000 > lastChangeEpoch;
}

/** Pure: '' when the CLI version is unchanged or unknown on either side; otherwise the HARNESS reason
 * for a run whose later cases ran on a different binary than its earlier ones. */
export function versionDrift(before, after) {
  if (!before || !after || before === after) return '';
  return `Claude Code changed version mid-run (${before} → ${after}): the auto-updater replaced the binary — re-run with --reuse-evals`;
}
