import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { printPass, printDeterministicOnly, printFail, claudeVersionFromOutput, pluginVersion, evalSection, baseReport, writeReportFile } from '../scripts/gate/verdict.mjs';

function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { fn(); } finally { console.log = original; }
  return lines;
}

test('printPass prints the exact PASS verdict line with the digest and exits 0', () => {
  process.exitCode = undefined;
  const lines = captureLog(() => printPass('abcdef123456'));
  assert.deepEqual(lines, ['gate: PASS (attested abcdef123456)']);
  assert.equal(process.exitCode, 0);
});

test('printDeterministicOnly prints a line containing "not a merge gate" and exits 0', () => {
  process.exitCode = undefined;
  const lines = captureLog(() => printDeterministicOnly());
  assert.match(lines[0], /not a merge gate/);
  assert.equal(process.exitCode, 0);
});

test('printFail prints the failing step and exits 1', () => {
  process.exitCode = undefined;
  const lines = captureLog(() => printFail('lint'));
  assert.deepEqual(lines, ['gate: FAIL lint']);
  assert.equal(process.exitCode, 1);
  process.exitCode = undefined; // this test intentionally sets a failing exit code — must not leak into the suite's own exit
});

test('claudeVersionFromOutput extracts a semver from the CLI banner', () => {
  assert.equal(claudeVersionFromOutput('2.1.269 (Claude Code)'), '2.1.269');
  assert.equal(claudeVersionFromOutput('not found'), null);
});

test('pluginVersion reads .claude-plugin/plugin.json, and is null (never throws) when absent or malformed', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-verdict-'));
  assert.equal(pluginVersion(root), null);
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '0.1.0' }));
  assert.equal(pluginVersion(root), '0.1.0');
});

test('evalSection carries the config thresholds and the aggregated per-case rows', () => {
  const section = evalSection({ threshold: 0.8, minDelta: 0.25 }, [{ name: 'c', ok: true, exit: 0, score: 1, delta: 1 }]);
  assert.equal(section.threshold, 0.8);
  assert.equal(section.minDelta, 0.25);
  assert.equal(section.cases[0].name, 'c');
});

test('baseReport fills every schema-2 field, defaulting attested/agenticRan/bypass/eval/review/digests until a branch overrides them', () => {
  const report = baseReport({ scope: { skills: ['a'], harness: false }, steps: [], ok: true, commit: 'abc', claudeVersion: '2.1.269', pluginVersion: '0.1.0' });
  assert.equal(report.schema, 2);
  assert.equal(report.attested, false);
  assert.equal(report.agenticRan, false);
  assert.equal(report.bypass, null);
  assert.equal(report.eval, null);
  assert.equal(report.review, null);
  assert.equal(report.skillsDigest, null);
  assert.equal(report.changed, report.scope.skills);
});

test('writeReportFile writes evals/gate-report.json, creating the evals/ dir if needed', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-verdict-'));
  const report = baseReport({ scope: { skills: [], harness: true }, steps: [], ok: true, commit: 'abc', claudeVersion: null, pluginVersion: null });
  const out = writeReportFile(root, report);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), report);
});
