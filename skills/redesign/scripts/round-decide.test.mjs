import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEADER, nextNumber, formatRow, appendRows, parseDecisionInput } from './round-decide.mjs';

const OLD = `# Decisions

| # | Date | Stage | Decision | Source |
|---|---|---|---|---|
| 1 | 2026-11-05 | process | The redesign runs in five stages. | session |
| 24 | 2026-11-05 | 1 | Style leaves the repo. | \`01-prd-1\` q.x |
`;

test('nextNumber counts from the highest # and tolerates both row formats', () => {
  assert.equal(nextNumber(''), 1);
  assert.equal(nextNumber(HEADER), 1);
  assert.equal(nextNumber(OLD), 25);
  assert.equal(nextNumber(`${HEADER}| 12 | 2026-11-14 | product | app | A. | chat |\n| 3 | 2026-11-14 | product | app | B. | chat |\n`), 13);
  assert.equal(nextNumber('| not | a | row |\n| x | 1 |\n'), 1);
});

test('formatRow writes the six columns, with replaces and scope suffixes', () => {
  const row = formatRow({ n: 12, date: '2026-11-14', kind: 'product', track: 'app', text: 'The router only routes.', source: '02-map-1 r.scope' });
  assert.equal(row, '| 12 | 2026-11-14 | product | app | The router only routes. | 02-map-1 r.scope |');
  assert.match(formatRow({ n: 13, date: 'd', kind: 'product', track: 'app', text: 'Changed.', source: 'chat', replaces: 7 }), /\| Changed\. \(replaces 7\) \|/);
  assert.match(formatRow({ n: 14, date: 'd', kind: 'standing', track: '-', text: 'Copy edits are yours.', source: 'chat', scope: 'wording only' }), /\| Copy edits are yours\. \(scope: wording only\) \|/);
});

test('formatRow keeps a row on one line and does not double a suffix', () => {
  const row = formatRow({ n: 1, date: 'd', kind: 'process', track: '-', text: 'a | b\nc (replaces 7)', source: 'chat', replaces: 7 });
  assert.equal(row.split('\n').length, 1);
  assert.equal(row, '| 1 | d | process | - | a \\| b c (replaces 7) | chat |');
});

test('appendRows creates the file with the header when it is empty', () => {
  const out = appendRows('', [{ date: '2026-11-14', kind: 'product', track: 'app', text: 'One.', source: 'chat' }]);
  assert.ok(out.startsWith('# Decisions'));
  assert.ok(out.includes(HEADER.trim()));
  assert.ok(out.endsWith('| 1 | 2026-11-14 | product | app | One. | chat |\n'));
});

test('appendRows numbers on from the highest # and keeps the earlier text', () => {
  const base = `${HEADER}| 4 | d | product | - | Four. | chat |\n`;
  const out = appendRows(base, [
    { date: 'd', kind: 'product', track: '-', text: 'Five.', source: 'chat' },
    { date: 'd', kind: 'process', track: '-', text: 'Six.', source: 'chat' },
  ]);
  assert.ok(out.startsWith(base));
  assert.match(out, /\| 5 \| d \|[^\n]*Five\.[^\n]*\n\| 6 \|/);
});

test('appending to an old-format file starts a new table so the columns stay honest', () => {
  const out = appendRows(OLD, [{ date: 'd', kind: 'product', track: '-', text: 'New.', source: 'chat' }]);
  assert.ok(out.startsWith(OLD));
  assert.match(out, /\n\n\| # \| Date \| Kind \| Track \| Decision \| Source \|\n\|---\|---\|---\|---\|---\|---\|\n\| 25 \|/);
});

test('appendRows adds a missing final newline and does not mutate its rows', () => {
  const rows = [{ date: 'd', kind: 'product', track: '-', text: 'X.', source: 'chat' }];
  const before = JSON.stringify(rows);
  appendRows(`${HEADER.trimEnd()}`, rows);
  assert.equal(JSON.stringify(rows), before);
});

test('parseDecisionInput validates a list of decisions and defaults the track', () => {
  const out = parseDecisionInput('[{"text":" One. ","kind":"product","source":"chat"}]');
  assert.deepEqual(out, [{ text: 'One.', kind: 'product', track: '-', source: 'chat' }]);
});

test('parseDecisionInput names the row and the problem', () => {
  assert.throws(() => parseDecisionInput('{oops'), /not valid JSON/);
  assert.throws(() => parseDecisionInput('{}'), /array/);
  assert.throws(() => parseDecisionInput('[]'), /at least one/);
  assert.throws(() => parseDecisionInput('[{"text":"x","kind":"idea","source":"chat"}]'), /decision 1: kind "idea" is not one of product, process, architecture, standing/);
  assert.throws(() => parseDecisionInput('[{"kind":"product","source":"chat"}]'), /decision 1: text is required/);
  assert.throws(() => parseDecisionInput('[{"text":"x","kind":"product"}]'), /decision 1: source is required/);
  assert.throws(() => parseDecisionInput('[{"text":"x","kind":"product","source":"chat","replaces":"seven"}]'), /replaces must be a decision number/);
});
