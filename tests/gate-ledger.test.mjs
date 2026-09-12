import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ledgerLine, appendLedgerLine, LEDGER_HEADER } from '../scripts/gate/ledger.mjs';

const ENTRY = { date: '2026-09-13', commit7: '5ecb65b', skills: 'architecture', casesCount: 3, costUsd: 4.77, durationSeconds: 1592, evalModel: 'claude-sonnet-5', judgeModel: 'claude-haiku-4-5', verdict: 'PASS' };

test('ledgerLine formats one row exactly as documented, shortening model names and rendering minutes to one decimal', () => {
  assert.equal(ledgerLine(ENTRY), '| 2026-09-13 | 5ecb65b | architecture | 3 cases | $4.77 | 26.5 min | sonnet-5/haiku-4-5 | PASS |');
});

test('appendLedgerLine creates evals/ledger.md with a header row when absent, then appends without rewriting it', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-ledger-'));
  const path = join(root, 'evals', 'ledger.md');
  assert.equal(existsSync(path), false);

  appendLedgerLine(root, ENTRY);
  let text = readFileSync(path, 'utf8');
  assert.ok(text.startsWith(LEDGER_HEADER), 'header row written once, up front');
  assert.equal(text.trim().split('\n').length, 3, 'header (2 lines) + one data row');

  appendLedgerLine(root, { ...ENTRY, commit7: '1234567' });
  text = readFileSync(path, 'utf8');
  assert.equal((text.match(/^\| date \|/gm) ?? []).length, 1, 'header is never duplicated');
  assert.equal(text.trim().split('\n').length, 4, 'header (2 lines) + two data rows: two runs, two lines');
});
