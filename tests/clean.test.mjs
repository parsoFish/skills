import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clean, resultsDirsToDelete, staleGateEvalFiles } from '../scripts/clean.mjs';

test('resultsDirsToDelete keeps only the newest `keep` directories, by ISO-timestamp name order', () => {
  const entries = [
    { name: '2026-09-12T11-00-00-000Z', isDirectory: true },
    { name: '2026-09-12T12-00-00-000Z', isDirectory: true },
    { name: '2026-09-12T13-00-00-000Z', isDirectory: true },
    { name: 'not-a-dir.txt', isDirectory: false },
  ];
  assert.deepEqual(resultsDirsToDelete(entries, 2), ['2026-09-12T11-00-00-000Z']);
  assert.deepEqual(resultsDirsToDelete(entries, 3), []);
  assert.deepEqual(resultsDirsToDelete(entries, 0), ['2026-09-12T11-00-00-000Z', '2026-09-12T12-00-00-000Z', '2026-09-12T13-00-00-000Z']);
});

test('staleGateEvalFiles matches every evals/gate-eval*.json scratch file, nothing else', () => {
  assert.deepEqual(staleGateEvalFiles(['gate-eval.json', 'gate-eval-drift.json', 'gate-report.json', 'ledger.md']), ['gate-eval.json', 'gate-eval-drift.json']);
});

function tempEvalsRoot(resultsDirNames, staleFiles) {
  const root = mkdtempSync(join(tmpdir(), 'clean-'));
  writeFileSync(join(root, 'gate.config.json'), JSON.stringify({ threshold: 0.8, minDelta: 0.25, maxCostUsd: 5, reviewBudgetUsd: 2, evalModel: 'claude-sonnet-5', judgeModel: 'claude-haiku-4-5', reviewModel: 'claude-sonnet-5', maxAttestationAgeDays: 30, resultsKeep: 3 }));
  for (const d of resultsDirNames) { mkdirSync(join(root, 'evals', 'results', d), { recursive: true }); writeFileSync(join(root, 'evals', 'results', d, 'aggregate-result.json'), '{}'); }
  for (const f of staleFiles) writeFileSync(join(root, 'evals', f), '{}');
  return root;
}

test('clean keeps only resultsKeep dirs under evals/results/ and deletes every stale gate-eval*.json', () => {
  const dirs = ['2026-09-12T11-00-00-000Z', '2026-09-12T12-00-00-000Z', '2026-09-12T13-00-00-000Z', '2026-09-12T14-00-00-000Z'];
  const root = tempEvalsRoot(dirs, ['gate-eval.json', 'gate-eval-a.json']);
  const { removedDirs, removedFiles } = clean(root, { resultsKeep: 3 });
  assert.deepEqual(removedDirs, ['2026-09-12T11-00-00-000Z']);
  assert.deepEqual(removedFiles.sort(), ['gate-eval-a.json', 'gate-eval.json']);
  assert.deepEqual(readdirSync(join(root, 'evals', 'results')).sort(), dirs.slice(1));
  assert.equal(existsSync(join(root, 'evals', 'gate-eval.json')), false);
});

test('clean reads resultsKeep from gate.config.json when not passed explicitly', () => {
  const root = tempEvalsRoot(['2026-09-12T11-00-00-000Z', '2026-09-12T12-00-00-000Z', '2026-09-12T13-00-00-000Z', '2026-09-12T14-00-00-000Z'], []);
  const { removedDirs } = clean(root);
  assert.deepEqual(removedDirs, ['2026-09-12T11-00-00-000Z'], 'gate.config.json in this fixture sets resultsKeep: 3');
});

test('clean is idempotent: running it twice in a row removes nothing the second time', () => {
  const root = tempEvalsRoot(['2026-09-12T11-00-00-000Z', '2026-09-12T12-00-00-000Z'], ['gate-eval.json']);
  clean(root, { resultsKeep: 3 });
  const second = clean(root, { resultsKeep: 3 });
  assert.deepEqual(second, { removedDirs: [], removedFiles: [] });
});

test('clean tolerates a repo with no evals/results/ directory yet', () => {
  const root = mkdtempSync(join(tmpdir(), 'clean-'));
  assert.deepEqual(clean(root, { resultsKeep: 3 }), { removedDirs: [], removedFiles: [] });
});
