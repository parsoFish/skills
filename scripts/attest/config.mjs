// Loads gate.config.json — attest.mjs never hardcodes a threshold, delta or age bound.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadConfig(root) {
  const path = join(root, 'gate.config.json');
  if (!existsSync(path)) throw new Error(`gate.config.json missing at ${path} — attest.mjs has no hardcoded fallback for it`);
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (err) { throw new Error(`gate.config.json is not valid JSON: ${err.message}`); }
}
