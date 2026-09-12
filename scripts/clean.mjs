#!/usr/bin/env node
// Prune generated eval artifacts the gate leaves behind: stale per-run result directories under
// evals/results/ (only `resultsKeep`, from gate.config.json, are worth keeping) and the scratch
// per-case `evals/gate-eval*.json` files the gate writes and then copies into evals/attest/. Safe to
// run any time; idempotent. Called automatically at the end of a successful agentic gate.
import { readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGateConfig } from './gate/config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Pure: given the { name, isDirectory } entries of evals/results/, which directory names to delete
 * to keep only the newest `keep` (names are ISO timestamps, so lexicographic sort is chronological). */
export function resultsDirsToDelete(entries, keep) {
  const dirs = entries.filter(e => e.isDirectory).map(e => e.name).sort();
  if (keep <= 0) return dirs;
  return dirs.slice(0, Math.max(0, dirs.length - keep));
}

/** Pure: which top-level evals/ file names are the stale per-case gate-eval scratch JSON. */
export function staleGateEvalFiles(fileNames) {
  return fileNames.filter(n => /^gate-eval.*\.json$/.test(n));
}

/** Apply the retention: prune evals/results/ to the newest `resultsKeep` dirs and delete every stale
 * evals/gate-eval*.json. Returns what was removed, for the caller (or a test) to assert on. */
export function clean(root, { resultsKeep } = {}) {
  const keep = resultsKeep ?? loadGateConfig(root).resultsKeep;

  const resultsDir = join(root, 'evals', 'results');
  const removedDirs = [];
  if (existsSync(resultsDir)) {
    const entries = readdirSync(resultsDir, { withFileTypes: true }).map(d => ({ name: d.name, isDirectory: d.isDirectory() }));
    for (const name of resultsDirsToDelete(entries, keep)) {
      rmSync(join(resultsDir, name), { recursive: true, force: true });
      removedDirs.push(name);
    }
  }

  const evalsDir = join(root, 'evals');
  const removedFiles = [];
  if (existsSync(evalsDir)) {
    const fileNames = readdirSync(evalsDir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
    for (const name of staleGateEvalFiles(fileNames)) {
      rmSync(join(evalsDir, name), { force: true });
      removedFiles.push(name);
    }
  }

  return { removedDirs, removedFiles };
}

function main() {
  const result = clean(ROOT);
  console.log(`clean: removed ${result.removedDirs.length} evals/results dir(s), ${result.removedFiles.length} stale gate-eval file(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
