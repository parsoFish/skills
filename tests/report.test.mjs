import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderReport, writeReport } from '../scripts/report.mjs';

const RERUN_CMD = 'setsid nohup node scripts/gate.mjs --all --force > /tmp/gate.log 2>&1 &';

function schema2Report() {
  return {
    schema: 2, ok: true, attested: true, agenticRan: true, bypass: null,
    generatedAt: '2026-09-13T02:10:00.000Z', commit: 'a'.repeat(40), claudeVersion: '2.1.269', pluginVersion: '0.2.0',
    scope: { skills: ['demo'], harness: false }, changed: ['demo'],
    steps: [{ name: 'lint', ok: true, detail: 'skills lint: ok' }, { name: 'tests', ok: true, detail: '' }],
    eval: {
      threshold: 0.8, minDelta: 0.25,
      cases: [{ name: 'demo-case', skill: 'demo', score: 1, scoreWithout: 0, delta: 1, partial: false, errors: [], turns: 12, costUsd: 0.5, durationSeconds: 90, model: 'claude-sonnet-5', judge: 'claude-haiku-4-5', exit: 0, evidence: 'evals/attest/demo-case.json' }],
    },
    review: { demo: { verdict: 'pass', findings: [], costUsd: 0.1 } },
    totals: { costUsd: 0.6, durationSeconds: 120 },
    skillsDigest: 'b'.repeat(64), harnessDigest: 'c'.repeat(64),
  };
}

function demoEvidence() {
  return {
    cases: [{
      name: 'demo-case',
      graders: [{ name: 'file-exists', type: 'file_exists' }, { name: 'skill-fired', type: 'tool_used' }],
      arms: {
        with: [{ graders: [{ name: 'file-exists', passed: true, explanation: 'docs/x.md exists' }, { name: 'skill-fired', passed: true, explanation: 'Skill called 1x' }] }],
        without: [{ graders: [{ name: 'file-exists', passed: false, explanation: 'docs/x.md missing' }] }],
      },
    }],
  };
}

test('renderReport is deterministic given the same inputs', () => {
  const report = schema2Report();
  const evidenceByCase = { 'demo-case': demoEvidence() };
  const a = renderReport(report, evidenceByCase, { ledgerTail: ['| 2026-09-12 | abc1234 | demo | 1 cases | $0.60 | 2.0 min | claude-sonnet-5/claude-haiku-4-5 | PASS |'] });
  const b = renderReport(report, evidenceByCase, { ledgerTail: ['| 2026-09-12 | abc1234 | demo | 1 cases | $0.60 | 2.0 min | claude-sonnet-5/claude-haiku-4-5 | PASS |'] });
  assert.equal(a, b);
});

test('renderReport puts the delta column immediately after the case name', () => {
  const md = renderReport(schema2Report(), {});
  assert.match(md, /\|\s*case\s*\|\s*Δ\s*\|/);
});

test('renderReport surfaces per-case grader with/without rows from the evidence', () => {
  const md = renderReport(schema2Report(), { 'demo-case': demoEvidence() });
  assert.match(md, /file-exists \| file_exists \| pass \| fail \| docs\/x\.md exists/);
  // skill-fired is with-only in real evidence: no without-arm entry, rendered as —
  assert.match(md, /skill-fired \| tool_used \| pass \| — \|/);
});

test('renderReport includes the exact rerun command', () => {
  const md = renderReport(schema2Report(), {});
  assert.ok(md.includes(RERUN_CMD));
});

test('renderReport is tolerant of a schema-1 report (missing fields render as —, never throw)', () => {
  // Shape of the real evals/gate-report.json before schema 2: no schema/generatedAt/commit/digests/totals,
  // and per-case entries carry only name/score/delta/exit.
  const schema1 = {
    changed: ['architecture'],
    steps: [{ name: 'lint', ok: true, detail: 'skills lint: ok' }],
    ok: true,
    eval: { ok: true, score: 1, threshold: 0.8, cases: [{ name: 'document-a-ts-monorepo', score: 1, delta: 1, exit: 0 }] },
    review: { architecture: { verdict: 'pass', findings: [] } },
  };
  let md;
  assert.doesNotThrow(() => { md = renderReport(schema1, {}); });
  assert.match(md, /document-a-ts-monorepo/);
  assert.match(md, /\| document-a-ts-monorepo \| 1 \| 1 \|/);
  assert.ok(md.includes('`—`'), 'missing commit/skillsDigest render as —');
  assert.ok(!md.includes('undefined') && !md.includes('NaN'));
});

function tempRoot() { return mkdtempSync(join(tmpdir(), 'report-')); }

test('writeReport reads gate-report.json + copied evidence and writes evals/REPORT.md', () => {
  const root = tempRoot();
  mkdirSync(join(root, 'evals', 'attest'), { recursive: true });
  writeFileSync(join(root, 'evals', 'gate-report.json'), JSON.stringify(schema2Report()));
  writeFileSync(join(root, 'evals', 'attest', 'demo-case.json'), JSON.stringify(demoEvidence()));
  const out = writeReport(root);
  assert.equal(out, join(root, 'evals', 'REPORT.md'));
  assert.ok(existsSync(out));
  const md = readFileSync(out, 'utf8');
  assert.match(md, /demo-case/);
  assert.match(md, /PASS — attested/);
});

test('writeReport throws a clear error when gate-report.json is missing (never a silent empty report)', () => {
  const root = tempRoot();
  assert.throws(() => writeReport(root), /gate-report\.json/);
});
