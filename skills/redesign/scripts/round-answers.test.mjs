import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, formatAnswers } from './round-answers.mjs';

const FEEDBACK = {
  round: '02-map-1', title: 'The map', submitted: true, submittedAt: '2026-11-14T01:00:00.000Z',
  asks: {
    'a.scope': { value: 'core', note: 'sessions first', accepted: false },
    'a.pace': { value: 'fast' },
    'a.areas': { value: ['x', 'y'] },
    'a.old': { value: 'settled' },
    'a.free': { value: 'my own words' },
  },
  items: { 'n.a': { value: 'drop', note: 'not needed' }, 'n.b': { value: 'keep' }, 'n.c': { value: 'keep', note: 'but later' } },
  comments: { 'sec.problem': 'too long', 'sec.empty': '  ' },
  extra: 'please shorten',
  reference: {
    asks: {
      'a.scope': { question: 'What first?', kind: 'choice', options: [{ value: 'core', label: 'Core' }, { value: 'all', label: 'Everything' }], recommended: ['all'] },
      'a.pace': { question: 'Pace?', kind: 'choice', options: { fast: 'Fast', slow: 'Slow' }, recommended: 'fast' },
      'a.areas': { question: 'Which areas?', kind: 'multi', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }], recommended: ['x', 'y'] },
      'a.old': { question: 'Already decided?', kind: 'choice', options: [], recommended: [], settled: { decision: 12 } },
      'a.free': { question: 'Say more', kind: 'text', options: [] },
      'a.missing': { question: 'Never answered?', kind: 'choice', options: [{ value: 'p', label: 'P' }], recommended: ['p'] },
      'a.opt': { question: 'Optional one', kind: 'text', optional: true },
    },
    items: { 'n.a': { name: 'Alpha', default: 'keep' }, 'n.b': { name: 'Beta', default: 'keep' }, 'n.c': { name: 'Gamma', default: 'keep' } },
  },
};

test('summarize resolves labels and compares each choice with the recommendation', () => {
  const s = summarize(FEEDBACK);
  const by = Object.fromEntries(s.asks.map((a) => [a.id, a]));
  assert.deepEqual(by['a.scope'].chosen, [{ value: 'core', label: 'Core' }]);
  assert.equal(by['a.scope'].matchedRecommendation, false);
  assert.equal(by['a.scope'].note, 'sessions first');
  assert.equal(by['a.pace'].chosen[0].label, 'Fast', 'old object-shaped options and string recommended');
  assert.equal(by['a.pace'].matchedRecommendation, true);
  assert.equal(by['a.areas'].matchedRecommendation, true);
  assert.equal(by['a.old'].settled, true);
  assert.equal(by['a.free'].text, 'my own words');
  assert.equal(by['a.free'].matchedRecommendation, null);
});

test('summarize lists only items off their default or carrying a note', () => {
  const ids = summarize(FEEDBACK).items.map((i) => i.id);
  assert.deepEqual(ids, ['n.a', 'n.c']);
  assert.equal(summarize(FEEDBACK).items[0].name, 'Alpha');
});

test('summarize lists unanswered required asks, comments with text, and the extra box', () => {
  const s = summarize(FEEDBACK);
  assert.deepEqual(s.unanswered, [{ id: 'a.missing', question: 'Never answered?' }]);
  assert.deepEqual(s.comments, [{ id: 'sec.problem', text: 'too long' }]);
  assert.equal(s.extra, 'please shorten');
  assert.equal(s.submitted, true);
});

test('summarize copes with a page that was never touched and does not mutate its input', () => {
  const before = JSON.stringify(FEEDBACK);
  summarize(FEEDBACK);
  assert.equal(JSON.stringify(FEEDBACK), before);
  const s = summarize({ round: 'r' });
  assert.deepEqual([s.asks, s.items, s.comments, s.unanswered, s.extra], [[], [], [], [], '']);
  assert.throws(() => summarize(null), /feedback must be a JSON object/);
});

test('an answer whose ask is missing from the reference is still shown', () => {
  const s = summarize({ asks: { 'z.q': { value: 'v' } } });
  assert.equal(s.asks[0].question, 'z.q');
  assert.deepEqual(s.asks[0].chosen, [{ value: 'v', label: 'v' }]);
});

test('formatAnswers writes a plain readable report', () => {
  const text = formatAnswers(summarize(FEEDBACK));
  assert.match(text, /02-map-1: The map \(finished/);
  assert.match(text, /What first\?\n {2}chosen: Core \[core\]\n {2}differs from the recommendation \(Everything\)\n {2}note: sessions first/);
  assert.match(text, /Pace\?\n {2}chosen: Fast \[fast\]\n {2}matches the recommendation/);
  assert.match(text, /Already decided\?\n {2}settled earlier/);
  assert.match(text, /Say more\n {2}answer: my own words/);
  assert.match(text, /Items changed\n {2}Alpha: drop \(default keep\) - not needed\n {2}Gamma: keep - but later/);
  assert.match(text, /Comments\n {2}sec\.problem: too long/);
  assert.match(text, /Anything else\n {2}please shorten/);
  assert.match(text, /Not answered\n {2}Never answered\? \[a\.missing\]/);
});

test('formatAnswers says when the page is not finished', () => {
  assert.match(formatAnswers(summarize({ round: 'r', submitted: false })), /in progress/);
});
