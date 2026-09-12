// Agentic half of the gate: per-case `claude plugin eval`, structural review per changed skill,
// evidence capture, and the digest-checked cache that lets an identical pass be reused for free.
// Depends on scripts/attest.mjs (digests, dirtyPaths, copyEvidence) and scripts/report.mjs
// (writeReport) — both owned by another stream, imported dynamically so the gate's other paths
// (deterministic, --no-agentic, --verify-only) still run before those land.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { caseNames, readEvalResult, aggregateEvals, harnessProblem, sandboxEnv, canReuseEval } from './eval.mjs';
import { spawnSync } from 'node:child_process';
import { runStructuralReview } from './review.mjs';
import { appendLedgerLine } from './ledger.mjs';
import { baseReport, evalSection, writeReportFile, printPass, printFail } from './verdict.mjs';
import { clean } from '../clean.mjs';

async function importAttest() {
  try { return await import('../attest.mjs'); }
  catch (err) { throw new Error(`scripts/attest.mjs is required to run the agentic gate but could not be imported (${err.message})`); }
}

async function importReport() {
  try { return await import('../report.mjs'); }
  catch (err) { throw new Error(`scripts/report.mjs is required to write evals/REPORT.md but could not be imported (${err.message})`); }
}

/** Run one `claude plugin eval --case <name>` and read its result. `sh` is the caller's process
 * runner (real or stubbed in tests). */
function lastChangeEpoch(root, skill) {
  const r = spawnSync('git', ['log', '-1', '--format=%ct', '--', `skills/${skill}`, `evals/${skill}`], { cwd: root, encoding: 'utf8' });
  const n = Number((r.stdout ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Pure over the filesystem: where a reusable result for this case may live, most raw first. */
export function reuseCandidates(root, caseName) {
  return [join(root, 'evals', `gate-eval-${caseName}.json`), join(root, 'evals', 'attest', `${caseName}.json`)].filter(existsSync);
}

function runOneCase(root, c, { evalModel, judgeModel, cap, config, sh, reuseEvals }) {
  const jsonPath = join(root, 'evals', `gate-eval-${c.name}.json`);
  const reportHtml = join(root, 'evals', 'results', `${c.name}.html`);
  // Crash recovery (--reuse-evals): a result produced after the last commit that touched this
  // skill's files is still evidence for this tree; the report records the reuse. The raw per-case
  // JSON is pruned by clean after a pass, so the tracked evidence copy is the second candidate.
  if (reuseEvals) {
    for (const candidate of reuseCandidates(root, c.name)) {
      try {
        const j = JSON.parse(readFileSync(candidate, 'utf8'));
        if (!canReuseEval(j, lastChangeEpoch(root, c.skill))) continue;
        const ev = readEvalResult(j, config);
        return { result: { ...c, exit: 0, model: evalModel, judge: judgeModel, jsonPath: candidate, reused: true, ...ev }, harness: harnessProblem(j) };
      } catch { /* try the next candidate, then a real run */ }
    }
  }
  // `claude plugin eval` filters cases by glob via --case; we still loop one case at a time for
  // per-case budget attribution and isolation, not because the flag only accepts a single name.
  const argv = ['plugin', 'eval', '.', '--trust-plugin', '--scaffold', '--allow-tools', 'Bash', 'Write', 'Edit',
    '--json', jsonPath, '--report', reportHtml, '--threshold', String(config.threshold),
    '--max-cost-usd', String(cap), '--no-publish', '--model', evalModel, '--judge-model', judgeModel, '--case', c.name];
  const r = sh('claude', argv, { env: sandboxEnv() });
  let ev = { ok: false, score: null, scoreWithout: null, delta: null, partial: true, errors: ['eval produced no result'], skippedPaidGraders: false, turns: null, costUsd: null, durationSeconds: null };
  let harness = '';
  try {
    const j = JSON.parse(readFileSync(jsonPath, 'utf8'));
    ev = readEvalResult(j, config);
    harness = harnessProblem(j);
  } catch (err) {
    ev = { ...ev, errors: [...ev.errors, `could not read ${jsonPath}: ${err.message}`] };
  }
  return { result: { ...c, exit: r.status, model: evalModel, judge: judgeModel, jsonPath, ...ev }, harness };
}

export async function runAgentic({ root, scope, config, args, det, sh, commit, claudeVersion, pluginVersion }) {
  const attest = await importAttest();
  const skillsDigestNow = attest.skillsDigest(root);
  const harnessDigestNow = attest.harnessDigest(root);

  const priorPath = join(root, 'evals', 'gate-report.json');
  const prior = existsSync(priorPath) ? JSON.parse(readFileSync(priorPath, 'utf8')) : null;
  const cacheHit = !args.force && prior?.schema === 2 && prior.attested === true && prior.skillsDigest === skillsDigestNow && prior.harnessDigest === harnessDigestNow;
  if (cacheHit) {
    console.log(`ok  claude plugin eval — cached pass for identical content (skillsDigest ${skillsDigestNow.slice(0, 12)})`);
    return printPass(skillsDigestNow.slice(0, 12));
  }

  const evalModel = args.evalModel ?? config.evalModel;
  const judgeModel = args.judgeModel ?? config.judgeModel;
  const cap = args.maxCostUsd ?? config.maxCostUsd;
  const meta = { commit, claudeVersion, pluginVersion };
  const fail = (step, extra = {}) => { writeReportFile(root, { ...baseReport({ scope, steps: det.steps, ok: false, ...meta }), ...extra }); return printFail(step); };

  const cases = scope.skills.flatMap(s => caseNames(root, s).map(c => ({ skill: s, name: c })));
  const perCase = [];
  let harnessMsg = '';
  for (const c of cases) {
    const { result, harness } = runOneCase(root, c, { evalModel, judgeModel, cap, config, sh, reuseEvals: args.reuseEvals === true });
    perCase.push(result);
    harnessMsg = harnessMsg || harness;
  }
  const agg = aggregateEvals(perCase);
  const evalOk = !harnessMsg && agg.ok;
  const reusedEvals = perCase.filter(c => c.reused).map(c => c.name);
  console.log(`${evalOk ? 'ok  ' : 'FAIL'} claude plugin eval (${cases.length} case${cases.length === 1 ? '' : 's'}${reusedEvals.length ? `, ${reusedEvals.length} reused` : ''}) — ${perCase.map(c => `${c.name} ${c.score ?? '?'}${c.delta != null ? ' Δ' + c.delta : ''}${c.reused ? ' (reused)' : ''}`).join(' · ')}`);

  if (harnessMsg) return fail(`claude plugin eval — HARNESS: ${harnessMsg}`, { agenticRan: true, eval: evalSection(config, perCase) });
  if (!agg.ok) return fail('claude plugin eval', { agenticRan: true, eval: evalSection(config, perCase) });

  const review = {};
  let reviewOk = true;
  if (!args.noReview) for (const s of scope.skills) {
    const rv = runStructuralReview(root, s, { ...config, reviewModel: args.reviewModel ?? config.reviewModel, reviewBudgetUsd: args.reviewBudgetUsd ?? config.reviewBudgetUsd });
    console.log(`${rv.ok ? 'ok  ' : 'FAIL'} structural review ${s} — ${rv.detail}`);
    review[s] = { verdict: rv.verdict, findings: rv.findings, costUsd: rv.costUsd };
    if (!rv.ok) reviewOk = false;
  }
  if (!reviewOk) return fail('structural review', { agenticRan: true, eval: evalSection(config, perCase), review });

  perCase.forEach(c => { c.evidence = attest.copyEvidence(root, c.name, c.jsonPath); });
  const dirty = attest.dirtyPaths(root);
  const skillsDigest = attest.skillsDigest(root);
  const harnessDigest = attest.harnessDigest(root);
  const attested = dirty.length === 0;

  const totalCostUsd = perCase.reduce((s, c) => s + (c.costUsd ?? 0), 0) + Object.values(review).reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const totalDurationSeconds = perCase.reduce((s, c) => s + (c.durationSeconds ?? 0), 0);

  const report = {
    ...baseReport({ scope, steps: det.steps, ok: true, ...meta }), agenticRan: true, attested,
    eval: evalSection(config, perCase), review, reusedEvals,
    totals: { costUsd: totalCostUsd, durationSeconds: totalDurationSeconds },
    skillsDigest, harnessDigest,
  };
  writeReportFile(root, report);
  if (!attested) return printFail(`working tree dirty: ${dirty.join(', ')}`);

  (await importReport()).writeReport(root);
  appendLedgerLine(root, {
    date: report.generatedAt.slice(0, 10), commit7: report.commit.slice(0, 7), skills: scope.skills.join('+'),
    casesCount: perCase.length, costUsd: totalCostUsd, durationSeconds: totalDurationSeconds,
    evalModel, judgeModel, verdict: reusedEvals.length ? `PASS (reused ${reusedEvals.length} eval result${reusedEvals.length === 1 ? '' : 's'})` : 'PASS',
  });
  clean(root);
  return printPass(skillsDigest.slice(0, 12));
}
