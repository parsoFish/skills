import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGateConfig, REQUIRED_GATE_CONFIG_KEYS } from '../scripts/gate/config.mjs';

function tempDir() { return mkdtempSync(join(tmpdir(), 'gate-config-')); }

test('loadGateConfig reads every declared key from gate.config.json, with no substituted defaults', () => {
  const root = tempDir();
  const full = { threshold: 0.8, minDelta: 0.25, maxCostUsd: 5, reviewBudgetUsd: 2, evalModel: 'claude-sonnet-5', judgeModel: 'claude-haiku-4-5', reviewModel: 'claude-sonnet-5', maxAttestationAgeDays: 30, resultsKeep: 3 };
  writeFileSync(join(root, 'gate.config.json'), JSON.stringify(full));
  assert.deepEqual(loadGateConfig(root), full);
});

test('loadGateConfig throws naming every missing required key instead of silently defaulting it', () => {
  const root = tempDir();
  writeFileSync(join(root, 'gate.config.json'), JSON.stringify({ threshold: 0.8, minDelta: 0.25 }));
  assert.throws(() => loadGateConfig(root), err => {
    for (const key of REQUIRED_GATE_CONFIG_KEYS.filter(k => k !== 'threshold' && k !== 'minDelta')) {
      assert.match(err.message, new RegExp(key));
    }
    return true;
  });
});

test('loadGateConfig throws a clear error when the file is missing', () => {
  const root = tempDir();
  assert.throws(() => loadGateConfig(root), /missing or unreadable/);
});

test('loadGateConfig throws a clear error on invalid JSON rather than swallowing the parse error', () => {
  const root = tempDir();
  writeFileSync(join(root, 'gate.config.json'), '{ not json');
  assert.throws(() => loadGateConfig(root), /not valid JSON/);
});
