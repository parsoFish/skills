// Loader for gate.config.json — the single source of the gate's thresholds and model choices.
// No default values live here or anywhere else in the gate: every key must be present in the
// committed config file, so a missing key fails fast instead of silently falling back to a
// hardcoded number nobody can find.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRED_GATE_CONFIG_KEYS = [
  'threshold',
  'minDelta',
  'maxCostUsd',
  'reviewBudgetUsd',
  'evalModel',
  'judgeModel',
  'reviewModel',
  'maxAttestationAgeDays',
  'resultsKeep',
];

/** Read and validate gate.config.json. Throws with a clear message on a missing file, invalid JSON,
 * or any missing required key — never silently substitutes a default. */
export function loadGateConfig(root, { path } = {}) {
  const configPath = path ?? join(root, 'gate.config.json');
  let raw;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new Error(`gate.config.json missing or unreadable at ${configPath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`gate.config.json is not valid JSON at ${configPath}: ${err.message}`);
  }
  const missing = REQUIRED_GATE_CONFIG_KEYS.filter(k => parsed[k] === undefined);
  if (missing.length) {
    throw new Error(`gate.config.json missing required key(s): ${missing.join(', ')} (at ${configPath})`);
  }
  return Object.freeze({ ...parsed });
}
