import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReviewServer, listenOnFreePort, fileUnder, readServerRecord, checkHealth, feedbackState } from './serve.mjs';

const SERVE = fileURLToPath(new URL('./serve.mjs', import.meta.url));
let work; // workspace
let dir; // work/reviews
let assets;
let server;
let port;

const freePort = () => new Promise((resolve, reject) => {
  const probe = http.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port: p } = probe.address(); probe.close(() => resolve(p)); });
});

/** One request to a server on `on`; headers override the defaults (Host among them). */
const call = (method, route, { headers = {}, body, on = port } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: on, method, path: route, headers: { Host: `127.0.0.1:${on}`, ...headers } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
  });
  req.on('error', reject);
  if (body !== undefined) req.write(body);
  req.end();
});
const json = { 'Content-Type': 'application/json' };
const fromPage = () => ({ ...json, Origin: `http://127.0.0.1:${port}` });
const closeServer = (s) => new Promise((resolve) => s.close(resolve));

before(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'redesign-serve-'));
  dir = path.join(work, 'reviews');
  assets = path.join(work, 'assets');
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, 'review.js'), '// client');
  fs.writeFileSync(path.join(assets, 'review.css'), '/* style */');
  fs.writeFileSync(path.join(assets, 'secret.txt'), 'not a kit file');
  for (const round of ['01-prd-1', '02-map-1']) {
    fs.mkdirSync(path.join(dir, round), { recursive: true });
    fs.writeFileSync(path.join(dir, round, 'index.html'), '<!doctype html><title>Round</title>');
  }
  fs.writeFileSync(path.join(dir, '01-prd-1', '.hidden'), 'no');
  fs.writeFileSync(path.join(dir, '01-prd-1', 'build.mjs'), "// the round's build script");
  fs.writeFileSync(path.join(dir, '01-prd-1', 'data.json'), '{"a":1}');
  fs.writeFileSync(path.join(dir, '01-prd-1', 'app.mjs'), 'export default 1;');
  port = await freePort();
  server = createReviewServer({ reviews: dir, port, workspace: work, assets });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
});

after(async () => {
  await closeServer(server);
  fs.rmSync(work, { recursive: true, force: true });
});

test('feedback saved from the page is read back, stamped with its round and save time', async () => {
  const answers = { asks: { 'q.scope': { value: 'core-first', note: 'sessions first' } }, items: { 'need.files': { value: 'drop' } }, submitted: false };
  const put = await call('PUT', '/api/feedback/01-prd-1', { headers: fromPage(), body: JSON.stringify(answers) });
  assert.equal(put.status, 200);
  const { savedAt } = JSON.parse(put.text);
  assert.match(savedAt, /^\d{4}-\d{2}-\d{2}T/);

  const got = JSON.parse((await call('GET', '/api/feedback/01-prd-1')).text);
  assert.deepEqual(got, { ...answers, round: '01-prd-1', savedAt });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '01-prd-1', 'feedback.json'), 'utf8')), got);
  assert.equal(fs.existsSync(path.join(work, 'feedback', '01-prd-1.json')), false, 'an unfinished page is not copied to feedback/');
});

test('a second save keeps the previous file as feedback.prev.json', async () => {
  await call('PUT', '/api/feedback/01-prd-1', { headers: fromPage(), body: JSON.stringify({ asks: { x: { value: 'b' } } }) });
  const prev = JSON.parse(fs.readFileSync(path.join(dir, '01-prd-1', 'feedback.prev.json'), 'utf8'));
  assert.ok(prev.asks['q.scope'], 'the earlier answers survive in the backup');
});

test('a submitted save also lands in feedback/<round>.json and says where', async () => {
  const body = { asks: { 'q.scope': { value: 'all', note: '' } }, submitted: true, submittedAt: '2026-11-14T01:00:00.000Z' };
  const put = JSON.parse((await call('PUT', '/api/feedback/02-map-1', { headers: fromPage(), body: JSON.stringify(body) })).text);
  assert.equal(put.savedTo, 'feedback/02-map-1.json');
  const copy = path.join(work, 'feedback', '02-map-1.json');
  const saved = JSON.parse(fs.readFileSync(copy, 'utf8'));
  assert.equal(saved.submitted, true);
  assert.equal(saved.round, '02-map-1');
  assert.equal(saved.savedTo, 'feedback/02-map-1.json');
  assert.match(fs.readFileSync(copy, 'utf8'), /\n {2}"asks"/, 'pretty-printed');
  const live = JSON.parse(fs.readFileSync(path.join(dir, '02-map-1', 'feedback.json'), 'utf8'));
  assert.equal(live.savedTo, 'feedback/02-map-1.json');
});

test('a save is refused from another site, with no origin, under another host name, or as anything but a JSON object', async () => {
  const body = JSON.stringify({ asks: {} });
  assert.equal((await call('PUT', '/api/feedback/01-prd-1', { headers: { ...json, Origin: 'http://evil.example' }, body })).status, 403);
  assert.equal((await call('PUT', '/api/feedback/01-prd-1', { headers: json, body })).status, 403);
  assert.equal((await call('PUT', '/api/feedback/01-prd-1', { headers: { ...fromPage(), Host: `evil.example:${port}` }, body })).status, 403);
  assert.equal((await call('PUT', '/api/feedback/01-prd-1', { headers: { ...fromPage(), 'Content-Type': 'text/plain' }, body })).status, 415);
  assert.equal((await call('PUT', '/api/feedback/01-prd-1', { headers: fromPage(), body: '[1,2]' })).status, 400);
  const broken = await call('PUT', '/api/feedback/01-prd-1', { headers: fromPage(), body: '{not json' });
  assert.equal(broken.status, 400);
  assert.match(JSON.parse(broken.text).error, /reload the page/);
});

test('feedback over the size limit is answered with a sentence, not a dropped connection', async () => {
  const big = JSON.stringify({ comments: { 'sec.problem': 'x'.repeat(2 * 1024 * 1024 + 10) } });
  const res = await call('PUT', '/api/feedback/01-prd-1', { headers: fromPage(), body: big });
  assert.equal(res.status, 413);
  assert.match(JSON.parse(res.text).error, /shorten the longest note/);
});

test('review pages, kit files and allow-listed static files are served; everything else is not', async () => {
  assert.equal((await call('GET', '/01-prd-1/')).status, 200);
  assert.equal((await call('GET', '/kit/review.js')).text, '// client');
  assert.equal((await call('GET', '/kit/review.css')).status, 200);
  assert.equal((await call('GET', '/kit/secret.txt')).status, 404);
  assert.equal((await call('GET', '/01-prd-1/data.json')).status, 200);
  assert.equal((await call('GET', '/01-prd-1/app.mjs')).headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await call('GET', '/01-prd-1/feedback.json')).status, 404, 'the answers go through the API only');
  assert.equal((await call('GET', '/01-prd-1/feedback.prev.json')).status, 404);
  assert.equal((await call('GET', '/01-prd-1/build.mjs')).status, 404, 'build scripts are never served');
  assert.equal((await call('GET', '/01-prd-1/Feedback.json')).status, 404);
  assert.equal((await call('GET', '/01-prd-1/feedback.json::$DATA')).status, 404);
  assert.equal((await call('GET', '/01-prd-1/index.html::$DATA')).status, 404);
  assert.equal((await call('GET', '/01-prd-1/FEEDBA~1.JSO')).status, 404);
  assert.equal((await call('GET', '/01-prd-1/index.html.')).status, 404);
  assert.equal((await call('GET', '/%zz')).status, 400);
  assert.equal((await call('GET', '/%2F01-prd-1')).status, 404);
  assert.equal((await call('GET', '/01-prd-1//index.html')).status, 404);
  assert.equal((await call('GET', '/01-prd-1/.hidden')).status, 404);
  assert.equal((await call('GET', '/01-prd-1/..%2f..%2fassets%2fsecret.txt')).status, 404);
  assert.equal((await call('GET', '/api/feedback/03-missing-1')).status, 404);
  assert.equal((await call('GET', '/api/feedback/..')).status, 404);
  assert.equal((await call('GET', '/api/feedback/Not_A_Round')).status, 400);
  assert.equal((await call('POST', '/01-prd-1/')).status, 405);
});

test('a review folder asked for without its slash is sent to the same folder on this server', async () => {
  const res = await call('GET', '/01-prd-1');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/01-prd-1/');
});

test('/health says the server is up and on which port', async () => {
  const res = await call('GET', '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), { ok: true, port });
  assert.equal(await checkHealth(port), true);
  assert.equal(await checkHealth(await freePort()), false);
});

test('the index lists rounds newest first and marks the finished ones', async () => {
  const html = (await call('GET', '/')).text;
  assert.ok(html.indexOf('02-map-1') < html.indexOf('01-prd-1'), 'newest first');
  assert.match(html, /02-map-1<\/a> <small>finished</);
  assert.match(html, /01-prd-1<\/a> <small>in progress</);
});

test('the index sorts round numbers as numbers', async () => {
  const names = ['03-sort-2', '03-sort-10'];
  for (const n of names) { fs.mkdirSync(path.join(dir, n)); fs.writeFileSync(path.join(dir, n, 'index.html'), 'x'); }
  try {
    const html = (await call('GET', '/')).text;
    assert.ok(html.indexOf('03-sort-10') < html.indexOf('03-sort-2'), 'newest (highest) first');
  } finally { for (const n of names) fs.rmSync(path.join(dir, n), { recursive: true, force: true }); }
});

test('fileUnder answers a file inside the root and nothing outside it', () => {
  assert.equal(fileUnder(dir, '01-prd-1/index.html'), fs.realpathSync(path.join(dir, '01-prd-1', 'index.html')));
  assert.equal(fileUnder(dir, '01-prd-1'), path.join(fs.realpathSync(path.join(dir, '01-prd-1')), 'index.html'));
  assert.equal(fileUnder(dir, '../outside.txt'), null);
  assert.equal(fileUnder(dir, '01-prd-1/.hidden'), null);
  assert.equal(fileUnder(dir, '01-prd-1/missing.html'), null);
  assert.equal(fileUnder(dir, '01-prd-1/build.mjs'), null);
  assert.equal(fileUnder(dir, '01-prd-1/data.json'), fs.realpathSync(path.join(dir, '01-prd-1', 'data.json')));
  assert.equal(fileUnder(dir, '01-prd-1\\index.html'), null);
});

test('a busy port makes the server take the next free one', async () => {
  const taken = await freePort();
  const squatter = http.createServer();
  await new Promise((resolve) => squatter.listen(taken, '127.0.0.1', resolve));
  const started = await listenOnFreePort({ reviews: dir, workspace: work, assets, port: taken });
  try {
    assert.ok(started.port > taken, `got ${started.port}, wanted above ${taken}`);
    assert.equal((await call('GET', '/health', { on: started.port })).status, 200);
  } finally {
    await closeServer(started.server);
    await closeServer(squatter);
  }
});

test('listenOnFreePort gives up with a sentence when no port in range is free', async () => {
  const taken = await freePort();
  const squatter = http.createServer();
  await new Promise((resolve) => squatter.listen(taken, '127.0.0.1', resolve));
  try {
    await assert.rejects(listenOnFreePort({ reviews: dir, workspace: work, assets, port: taken, tries: 1 }), /no free port/);
  } finally {
    await closeServer(squatter);
  }
});

test('feedbackState names the state of a round from its live file', () => {
  assert.equal(feedbackState(path.join(dir, '02-map-1', 'feedback.json')), 'finished');
  assert.equal(feedbackState(path.join(dir, '01-prd-1', 'feedback.json')), 'in progress');
  assert.equal(feedbackState(path.join(dir, 'nowhere.json')), 'not opened');
  const bad = path.join(work, 'bad.json');
  fs.writeFileSync(bad, '{oops');
  assert.equal(feedbackState(bad), 'feedback unreadable');
});

test('--detach starts a server in the background, prints its address once it answers, and records it', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'redesign-detach-'));
  const wanted = await freePort();
  const run = spawnSync(process.execPath, [SERVE, '--detach', '--port', String(wanted), '--workspace', ws], { encoding: 'utf8', timeout: 20000 });
  const record = readServerRecord(path.join(ws, 'reviews'));
  try {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), `review server: http://127.0.0.1:${wanted}/`);
    assert.equal(record.port, wanted);
    assert.equal(record.url, `http://127.0.0.1:${wanted}/`);
    assert.ok(record.pid > 0 && record.startedAt);
    assert.equal(await checkHealth(wanted), true);
  } finally {
    if (record?.pid) { try { process.kill(record.pid, 'SIGTERM'); } catch { /* already gone */ } }
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('a bad --port is a plain sentence and a non-zero exit', () => {
  const run = spawnSync(process.execPath, [SERVE, '--port', '80'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--port must be 1024 to 65535/);
});
