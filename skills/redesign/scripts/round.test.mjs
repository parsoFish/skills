import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateRound, stageLabel, openerFor, lastRound, waitForSubmit, nextNumber, appendRows, formatRow } from './round.mjs';
import { readServerRecord, checkHealth } from './serve.mjs';
import { fakeKit } from './round-fixtures.test.mjs';

const ROUND_CLI = fileURLToPath(new URL('./round.mjs', import.meta.url));
const SCRIPTS = path.dirname(ROUND_CLI);

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'redesign-round-'));
const cli = (ws, args, { input, env = {} } = {}) => spawnSync(process.execPath, [ROUND_CLI, ...args, '--workspace', ws], {
  encoding: 'utf8', input: input ?? '', env: { ...process.env, REDESIGN_NO_BROWSER: '1', ...env },
});
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const FEEDBACK = (submitted) => JSON.stringify({
  round: '02-map-1', title: 'The map', submitted,
  asks: { 'a.scope': { value: 'core', note: 'sessions first' } },
  reference: { asks: { 'a.scope': { question: 'What first?', kind: 'choice', options: [{ value: 'core', label: 'Core' }], recommended: ['core'] } }, items: {} },
});

test('round ids are checked', () => {
  assert.equal(validateRound('02-map-1'), '02-map-1');
  for (const bad of ['map-1', '2-map-1', '02-Map-1', '02-map', '02-map-x', '', undefined, '../02-map-1']) assert.throws(() => validateRound(bad), /is not a round id/);
});

test('stageLabel reads the stage from the id unless overridden', () => {
  assert.equal(stageLabel('04-mock-1'), 'Stage 4 · mock');
  assert.equal(stageLabel('04-mock-1', '5'), 'Stage 5 · mock');
  assert.throws(() => stageLabel('04-mock-1', 'x'), /--stage must be a whole number/);
});

test('openerFor picks by platform and what exists, and is null when nothing does', () => {
  const only = (...names) => (n) => names.includes(n);
  assert.equal(openerFor({ platform: 'linux', has: only('xdg-open', 'cmd.exe') }).command, 'xdg-open');
  assert.equal(openerFor({ platform: 'linux', has: only('cmd.exe') }).command, 'cmd.exe');
  assert.deepEqual(openerFor({ platform: 'linux', has: only('cmd.exe') }).args, ['/c', 'start', '']);
  assert.equal(openerFor({ platform: 'darwin', has: only('open', 'xdg-open') }).command, 'open');
  assert.equal(openerFor({ platform: 'win32', has: only('cmd') }).command, 'cmd');
  assert.equal(openerFor({ platform: 'linux', has: () => false }), null);
});

test('lastRound is the newest round folder', () => {
  const ws = tmp();
  try {
    assert.equal(lastRound(path.join(ws, 'reviews')), null);
    for (const n of ['01-prd-1', '02-map-2', '02-map-10', 'notes', '.kit']) write(path.join(ws, 'reviews', n, 'x'), '');
    assert.equal(lastRound(path.join(ws, 'reviews')), '02-map-10');
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('waitForSubmit polls until the file says submitted, and gives up at the deadline', async () => {
  const ws = tmp();
  try {
    const file = path.join(ws, 'feedback.json');
    let clock = 0;
    let polls = 0;
    const sleep = async (ms) => { clock += ms; polls += 1; if (polls === 2) write(file, '{"submitted":false'); if (polls === 3) write(file, '{"submitted":true,"n":1}'); };
    const done = await waitForSubmit({ file, timeoutMs: 10000, everyMs: 1000, now: () => clock, sleep });
    assert.deepEqual(done, { submitted: true, n: 1 });
    assert.equal(polls, 3);
    clock = 0;
    write(file, '{"submitted":false}');
    assert.equal(await waitForSubmit({ file, timeoutMs: 3000, everyMs: 1000, now: () => clock, sleep: async (ms) => { clock += ms; } }), null);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('new scaffolds the build script and records the kit; it refuses a repeat and a bad id', () => {
  const ws = tmp();
  try {
    const made = cli(ws, ['new', '01-prd-1', '--title', 'The PRD']);
    assert.equal(made.status, 0, made.stderr);
    const build = fs.readFileSync(path.join(ws, 'reviews', '01-prd-1', 'build.mjs'), 'utf8');
    assert.match(build, /"The PRD"/);
    assert.match(build, /Stage 1 · prd/);
    assert.equal(fs.readFileSync(path.join(ws, 'reviews', '.kit'), 'utf8').trim(), SCRIPTS);
    const ignore = fs.readFileSync(path.join(ws, 'reviews', '.gitignore'), 'utf8');
    for (const line of ['*/index.html', '*/feedback.json', '*/_shots/', '.server.json']) assert.ok(ignore.includes(line), `ignore lacks ${line}`);
    fs.writeFileSync(path.join(ws, 'reviews', '.gitignore'), 'mine\n');
    cli(ws, ['new', '01-prd-2']);
    assert.equal(fs.readFileSync(path.join(ws, 'reviews', '.gitignore'), 'utf8'), 'mine\n', 'an existing ignore file is left alone');
    const again = cli(ws, ['new', '01-prd-1']);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/);
    assert.match(cli(ws, ['new', 'prd']).stderr, /is not a round id/);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('build runs the round script against the kit and prints its counts line', () => {
  const ws = tmp();
  try {
    const kit = fakeKit(ws);
    cli(ws, ['new', '01-prd-1']);
    const built = cli(ws, ['build', '01-prd-1'], { env: { REDESIGN_KIT: kit } });
    assert.equal(built.status, 0, built.stderr);
    assert.match(built.stdout, /01-prd-1: 1 ask, 0 items, 1 figure/);
    assert.ok(fs.existsSync(path.join(ws, 'reviews', '01-prd-1', 'index.html')));
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('build fails, with the cause on screen, when the round script throws or is missing', () => {
  const ws = tmp();
  try {
    write(path.join(ws, 'reviews', '01-prd-1', 'build.mjs'), 'throw new Error("a count did not match");');
    const failed = cli(ws, ['build', '01-prd-1']);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /a count did not match/);
    assert.match(failed.stderr, /build of 01-prd-1 failed/);
    assert.match(cli(ws, ['build', '02-map-1']).stderr, /no build script/);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('decide appends numbered rows from stdin, then from a file, and creates DECISIONS.md', () => {
  const ws = tmp();
  try {
    const first = cli(ws, ['decide', '--date', '2026-11-14'], { input: JSON.stringify([{ text: 'One.', kind: 'product', track: 'app', source: '02-map-1 r.scope' }, { text: 'Two.', kind: 'process', source: 'chat' }]) });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /decisions 1, 2/);
    write(path.join(ws, 'more.json'), JSON.stringify([{ text: 'Three.', kind: 'architecture', source: 'spike db', replaces: 1 }]));
    const second = cli(ws, ['decide', '--file', path.join(ws, 'more.json'), '--date', '2026-11-15']);
    assert.match(second.stdout, /decisions 3 in/);
    const md = fs.readFileSync(path.join(ws, 'DECISIONS.md'), 'utf8');
    assert.match(md, /\| # \| Date \| Kind \| Track \| Decision \| Source \|/);
    assert.match(md, /\| 1 \| 2026-11-14 \| product \| app \| One\. \| 02-map-1 r\.scope \|/);
    assert.match(md, /\| 2 \| 2026-11-14 \| process \| - \| Two\. \| chat \|/);
    assert.match(md, /\| 3 \| 2026-11-15 \| architecture \| - \| Three\. \(replaces 1\) \| spike db \|/);
    assert.equal(nextNumber(md), 4);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('decide refuses a bad kind or date without touching DECISIONS.md', () => {
  const ws = tmp();
  try {
    const bad = cli(ws, ['decide'], { input: JSON.stringify([{ text: 'x', kind: 'idea', source: 'chat' }]) });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /decision 1: kind "idea"/);
    assert.match(cli(ws, ['decide', '--date', '14/11/2026'], { input: '[]' }).stderr, /--date must be YYYY-MM-DD/);
    assert.equal(fs.existsSync(path.join(ws, 'DECISIONS.md')), false);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('answers reads the kept copy, falls back to the live file, and can print JSON', () => {
  const ws = tmp();
  try {
    assert.match(cli(ws, ['answers', '02-map-1']).stderr, /no answers for 02-map-1/);
    write(path.join(ws, 'reviews', '02-map-1', 'feedback.json'), FEEDBACK(false));
    const live = cli(ws, ['answers', '02-map-1']);
    assert.equal(live.status, 0, live.stderr);
    assert.match(live.stdout, /in progress/);
    write(path.join(ws, 'feedback', '02-map-1.json'), FEEDBACK(true));
    const kept = cli(ws, ['answers', '02-map-1']);
    assert.match(kept.stdout, /What first\?\n {2}chosen: Core \[core\]\n {2}matches the recommendation\n {2}note: sessions first/);
    const asJson = JSON.parse(cli(ws, ['answers', '02-map-1', '--json']).stdout);
    assert.equal(asJson.asks[0].id, 'a.scope');
    assert.equal(asJson.submitted, true);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

const spawnAsync = (ws, args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [ROUND_CLI, ...args, '--workspace', ws], { env: { ...process.env, REDESIGN_NO_BROWSER: '1' } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

test('wait returns the answers once the page is finished', async () => {
  const ws = tmp();
  try {
    write(path.join(ws, 'reviews', '02-map-1', 'index.html'), '<title>x</title>');
    write(path.join(ws, 'reviews', '02-map-1', 'feedback.json'), FEEDBACK(false));
    const waiting = spawnAsync(ws, ['wait', '02-map-1', '--every', '0.1', '--timeout', '20']);
    setTimeout(() => write(path.join(ws, 'reviews', '02-map-1', 'feedback.json'), FEEDBACK(true)), 400);
    const done = await waiting;
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /finished/);
    assert.match(done.stdout, /chosen: Core/);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('wait exits 2 on timeout and 1 when the round has no page', async () => {
  const ws = tmp();
  try {
    write(path.join(ws, 'reviews', '02-map-1', 'index.html'), '<title>x</title>');
    const late = await spawnAsync(ws, ['wait', '02-map-1', '--every', '0.1', '--timeout', '0.3']);
    assert.equal(late.status, 2);
    assert.match(late.stderr, /timed out after 0\.3 s/);
    const none = await spawnAsync(ws, ['wait', '03-none-1']);
    assert.equal(none.status, 1);
    assert.match(none.stderr, /has no page yet/);
    assert.match((await spawnAsync(ws, ['wait', '02-map-1', '--timeout', '0'])).stderr, /--timeout must be a number of seconds above 0/);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('status reports the server, last round, decisions and STATE.md heading', () => {
  const ws = tmp();
  try {
    assert.match(cli(ws, ['status']).stdout, /server: not running\nlast round: none yet\ndecisions: none recorded\nSTATE\.md: no heading found/);
    write(path.join(ws, 'reviews', '02-map-1', 'feedback.json'), FEEDBACK(true));
    write(path.join(ws, 'reviews', '.server.json'), JSON.stringify({ pid: 1, port: 9, url: 'http://127.0.0.1:9/' }));
    write(path.join(ws, 'DECISIONS.md'), appendRows('', [{ date: 'd', kind: 'product', track: '-', text: 'A.', source: 'chat' }]));
    write(path.join(ws, 'STATE.md'), '\n# Where we are\n\nStage 2.\n');
    const out = cli(ws, ['status']).stdout;
    assert.match(out, /server: not running \(a stale \.server\.json/);
    assert.match(out, /last round: 02-map-1 \(finished\)/);
    assert.match(out, /decisions: highest number 1/);
    assert.match(out, /STATE\.md: Where we are/);
    const asJson = JSON.parse(cli(ws, ['status', '--json']).stdout);
    assert.deepEqual([asJson.highestDecision, asJson.lastRound.round, asJson.server.running], [1, '02-map-1', false]);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('open starts a server when none answers, prints the round address, and opens no browser under --no-browser', async () => {
  const ws = tmp();
  let record;
  try {
    write(path.join(ws, 'reviews', '02-map-1', 'index.html'), '<title>x</title>');
    const noPage = cli(ws, ['open', '03-none-1', '--no-browser']);
    assert.equal(noPage.status, 1);
    assert.match(noPage.stderr, /has no page yet/);
    const opened = cli(ws, ['open', '02-map-1', '--no-browser']);
    record = readServerRecord(path.join(ws, 'reviews'));
    assert.equal(opened.status, 0, opened.stderr);
    assert.equal(opened.stdout.trim(), `${record.url}02-map-1/`);
    assert.equal(await checkHealth(record.port), true);
    const again = cli(ws, ['open', '02-map-1', '--no-browser']);
    assert.equal(again.stdout.trim(), opened.stdout.trim(), 'the running server is reused');
    assert.equal(readServerRecord(path.join(ws, 'reviews')).pid, record.pid);
    assert.match(cli(ws, ['status']).stdout, new RegExp(`server: running at ${record.url}`));
  } finally {
    if (record?.pid) { try { process.kill(record.pid, 'SIGTERM'); } catch { /* already gone */ } }
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('the usage text lists every verb, and an unknown one is refused', () => {
  const ws = tmp();
  try {
    const help = cli(ws, ['--help']);
    for (const verb of ['new', 'build', 'open', 'wait', 'answers', 'decide', 'status']) assert.match(help.stdout, new RegExp(`round\\.mjs ${verb}\\b`));
    assert.match(cli(ws, ['frobnicate']).stderr, /unknown verb "frobnicate"/);
    assert.match(cli(ws, ['status', '--bogus']).stderr, /unknown flag --bogus/);
    assert.equal(formatRow({ n: 1, date: 'd', kind: 'product', track: '-', text: 't', source: 's' }), '| 1 | d | product | - | t | s |');
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});
