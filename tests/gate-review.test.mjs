import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewOutput, runStructuralReview, reviewPrompt } from '../scripts/gate/review.mjs';

function claudeJsonLine(obj) { return JSON.stringify(obj); }

test('parseReviewOutput reads the structured verdict and the run cost from total_cost_usd', () => {
  const out = claudeJsonLine({ structured_output: { verdict: 'pass', findings: [] }, total_cost_usd: 0.42, terminal_reason: 'completed' });
  const { verdict, costUsd } = parseReviewOutput(out);
  assert.deepEqual(verdict, { verdict: 'pass', findings: [] });
  assert.equal(costUsd, 0.42);
});

test('parseReviewOutput reads the verdict from a JSON-string `result` field when structured_output is absent', () => {
  const out = claudeJsonLine({ result: JSON.stringify({ verdict: 'fail', findings: [{ severity: 'major', finding: 'x' }] }), total_cost_usd: 0.1 });
  assert.deepEqual(parseReviewOutput(out).verdict, { verdict: 'fail', findings: [{ severity: 'major', finding: 'x' }] });
});

test('parseReviewOutput synthesises a fail verdict when the run did not complete and produced no verdict', () => {
  const out = claudeJsonLine({ terminal_reason: 'max_turns', total_cost_usd: 0.2 });
  const { verdict } = parseReviewOutput(out);
  assert.equal(verdict.verdict, 'fail');
  assert.match(verdict.findings[0].finding, /max_turns/);
});

test('parseReviewOutput never throws on unparsable output; it reports no verdict and zero cost', () => {
  assert.deepEqual(parseReviewOutput('not json at all'), { verdict: null, costUsd: 0 });
});

test('parseReviewOutput reads the last JSON line, ignoring any preceding log noise', () => {
  const out = `some log line\n${claudeJsonLine({ structured_output: { verdict: 'pass', findings: [] }, total_cost_usd: 0.05 })}`;
  assert.equal(parseReviewOutput(out).costUsd, 0.05);
});

test('reviewPrompt names the skill under review', () => {
  assert.match(reviewPrompt('architecture'), /skills\/architecture/);
});

test('runStructuralReview reports ok only on exit 0 with verdict pass, and always surfaces the cost', () => {
  const config = { reviewModel: 'claude-sonnet-5', reviewBudgetUsd: 2 };
  const passRun = () => ({ status: 0, stdout: claudeJsonLine({ structured_output: { verdict: 'pass', findings: [] }, total_cost_usd: 0.3 }), stderr: '' });
  const pass = runStructuralReview('/root', 'architecture', config, passRun);
  assert.equal(pass.ok, true);
  assert.equal(pass.costUsd, 0.3);
  assert.equal(pass.verdict, 'pass');

  const failRun = () => ({ status: 0, stdout: claudeJsonLine({ structured_output: { verdict: 'fail', findings: [{ severity: 'critical', finding: 'bad' }] }, total_cost_usd: 0.1 }), stderr: '' });
  const fail = runStructuralReview('/root', 'architecture', config, failRun);
  assert.equal(fail.ok, false);
  assert.match(fail.detail, /critical/);

  const crashRun = () => ({ status: 1, stdout: '', stderr: 'boom' });
  const crashed = runStructuralReview('/root', 'architecture', config, crashRun);
  assert.equal(crashed.ok, false);
  assert.match(crashed.detail, /no structured verdict/);
});
