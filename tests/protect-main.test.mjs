import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectionPayload, parseOwnerRepo, normalizeCurrentProtection, diffProtection } from '../scripts/protect-main.mjs';

test('protectionPayload matches the required shape exactly', () => {
  assert.deepEqual(protectionPayload(), {
    required_status_checks: { strict: true, contexts: ['deterministic', 'attested'] },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
    required_linear_history: true,
    required_conversation_resolution: true,
  });
});

test('protectionPayload accepts a different context list without touching anything else', () => {
  const p = protectionPayload({ contexts: ['a', 'b'] });
  assert.deepEqual(p.required_status_checks.contexts, ['a', 'b']);
  assert.equal(p.enforce_admins, false);
});

test('parseOwnerRepo handles https and ssh remotes, with or without .git', () => {
  assert.deepEqual(parseOwnerRepo('https://github.com/parsoFish/skills'), { owner: 'parsoFish', repo: 'skills' });
  assert.deepEqual(parseOwnerRepo('https://github.com/parsoFish/skills.git'), { owner: 'parsoFish', repo: 'skills' });
  assert.deepEqual(parseOwnerRepo('git@github.com:parsoFish/skills.git'), { owner: 'parsoFish', repo: 'skills' });
});

test('parseOwnerRepo throws on an unparsable remote', () => {
  assert.throws(() => parseOwnerRepo('not a url'), /cannot parse owner\/repo/);
  assert.throws(() => parseOwnerRepo(undefined), /cannot parse owner\/repo/);
});

test('normalizeCurrentProtection unwraps GitHub\'s {enabled} shape into bare booleans', () => {
  const current = {
    required_status_checks: { strict: true, contexts: ['attested', 'deterministic'] },
    enforce_admins: { enabled: false },
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
    required_linear_history: { enabled: true },
    required_conversation_resolution: { enabled: true },
  };
  assert.deepEqual(normalizeCurrentProtection(current), {
    required_status_checks: { strict: true, contexts: ['attested', 'deterministic'] },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
    required_linear_history: true,
    required_conversation_resolution: true,
  });
});

test('normalizeCurrentProtection treats a missing sub-resource as disabled/null, not a crash', () => {
  assert.deepEqual(normalizeCurrentProtection({}), {
    required_status_checks: { strict: false, contexts: [] },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
    required_linear_history: false,
    required_conversation_resolution: false,
  });
});

test('diffProtection reports no diffs when the live state already matches (idempotent apply)', () => {
  const desired = protectionPayload();
  const current = {
    required_status_checks: { strict: true, contexts: ['deterministic', 'attested'] },
    enforce_admins: { enabled: false },
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
    required_linear_history: { enabled: true },
    required_conversation_resolution: { enabled: true },
  };
  assert.deepEqual(diffProtection(current, desired), []);
});

test('diffProtection names every field that is wrong', () => {
  const desired = protectionPayload();
  const current = {
    required_status_checks: { strict: false, contexts: ['deterministic'] },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: { required_approving_review_count: 1 },
    allow_force_pushes: { enabled: true },
    allow_deletions: { enabled: false },
    required_linear_history: { enabled: false },
    required_conversation_resolution: { enabled: true },
  };
  const diffs = diffProtection(current, desired);
  assert.ok(diffs.some(d => d.startsWith('required_status_checks.strict')));
  assert.ok(diffs.some(d => d.startsWith('required_status_checks.contexts')));
  assert.ok(diffs.some(d => d.startsWith('enforce_admins')));
  assert.ok(diffs.some(d => d.startsWith('required_pull_request_reviews')));
  assert.ok(diffs.some(d => d.startsWith('allow_force_pushes')));
  assert.ok(diffs.some(d => d.startsWith('required_linear_history')));
  assert.ok(!diffs.some(d => d.startsWith('allow_deletions')), 'allow_deletions already matches and must not be reported');
});

test('diffProtection is order-insensitive on the contexts list', () => {
  const desired = protectionPayload({ contexts: ['attested', 'deterministic'] });
  const current = { required_status_checks: { strict: true, contexts: ['deterministic', 'attested'] }, enforce_admins: { enabled: false }, required_pull_request_reviews: null, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false }, required_linear_history: { enabled: true }, required_conversation_resolution: { enabled: true } };
  assert.deepEqual(diffProtection(current, desired), []);
});
