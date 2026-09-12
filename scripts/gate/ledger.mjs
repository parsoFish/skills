// Append-only cost ledger for agentic gate runs (B16). Never rewritten — one row per run, so the
// owner can see spend trend over time without reconstructing it from evals/attest/*.json.
import { existsSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const LEDGER_HEADER = '| date | commit | skills | cases | cost | duration | models | verdict |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n';

/** Pure: format one ledger row. Model names are shortened by dropping the `claude-` prefix
 * (`claude-sonnet-5` -> `sonnet-5`) to match the brief's example row. */
export function ledgerLine({ date, commit7, skills, casesCount, costUsd, durationSeconds, evalModel, judgeModel, verdict }) {
  const short = m => String(m).replace(/^claude-/, '');
  const minutes = (durationSeconds / 60).toFixed(1);
  return `| ${date} | ${commit7} | ${skills} | ${casesCount} cases | $${costUsd.toFixed(2)} | ${minutes} min | ${short(evalModel)}/${short(judgeModel)} | ${verdict} |`;
}

/** Append one row to evals/ledger.md, creating it with a header row if the file is absent. */
export function appendLedgerLine(root, entry) {
  const p = join(root, 'evals', 'ledger.md');
  if (!existsSync(p)) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, LEDGER_HEADER); }
  appendFileSync(p, ledgerLine(entry) + '\n');
  return p;
}
