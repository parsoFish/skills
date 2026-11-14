#!/usr/bin/env node
// The review server: serves review pages and stores what the reviewer enters. Loopback only.
//   node serve.mjs [--port 7800] [--dir reviews] [--workspace .] [--detach]
//   page      http://127.0.0.1:<port>/<round>/     <dir>/<round>/index.html
//   feedback  GET|PUT /api/feedback/<round>        <dir>/<round>/feedback.json (a finished page is also copied to <workspace>/feedback/<round>.json)
//   kit       /kit/review.js, /kit/review.css      ../assets/
//   health    /health                              {"ok":true,"port":<port>}
// A busy port is skipped for the next free one. The address is printed and recorded in <dir>/.server.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseFlags } from './round-args.mjs';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const DEFAULT_PORT = 7800;
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const PORT_TRIES = 50;
const HOST = '127.0.0.1';
const MAX_BODY = 2 * 1024 * 1024;
const BACKUP_EVERY_MS = 5 * 60 * 1000;
const DETACH_WAIT_MS = 10000;
const HEALTH_TIMEOUT_MS = 1500;
const ROUND = /^[a-z0-9][a-z0-9-]{0,60}$/;
const KIT_FILES = new Set(['review.js', 'review.css']);
// Files a review folder holds for the tools, not for the page: the answers go through the API only.
const RESERVED = /^(build\.mjs|feedback(\.prev)?\.json)$/i;
const CSP = "default-src 'self' 'unsafe-inline' data: blob:; frame-ancestors 'none'";
const JSON_TYPE = 'application/json; charset=utf-8';
const FLAGS = { '--port': 'value', '--dir': 'value', '--workspace': 'value', '--detach': 'bool' };
// The only kinds of file a page may load.
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': JSON_TYPE, '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** An error that carries the HTTP status it should answer with. */
const httpError = (status, message) => Object.assign(new Error(message), { status });

const send = (res, status, body, type = JSON_TYPE) => {
  res.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
};

/** A path segment the server never follows: hidden, or a spelling Windows resolves to some other file (a stream, a short name, a trailing dot). */
const refused = (part) => part.startsWith('.') || /[\\:~]/.test(part) || /[. ]$/.test(part);

/** The real path of `rel` under `root`, or null when it leaves the root, is hidden, reserved, not a servable kind, or not a file. */
export const fileUnder = (root, rel) => {
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(refused)) return null;
  const full = path.resolve(root, ...parts);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(full)) return null;
  const real = fs.realpathSync(full);
  const realRoot = fs.realpathSync(root);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  const target = fs.statSync(real).isDirectory() ? path.join(real, 'index.html') : real;
  if (!(path.extname(target).toLowerCase() in STATIC_TYPES) || RESERVED.test(path.basename(target))) return null;
  return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      // Drain the rest so the page gets the sentence instead of a dropped connection.
      chunks.length = 0;
      req.removeAllListeners('data');
      req.resume();
      reject(httpError(413, `feedback is over ${MAX_BODY / 1024 / 1024} MiB: shorten the longest note`));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const roundDir = (reviews, round) => {
  if (!ROUND.test(round)) throw httpError(400, `"${round}" is not a review name (lower-case letters, digits and dashes)`);
  const dir = path.join(reviews, round);
  if (!fs.existsSync(path.join(dir, 'index.html'))) throw httpError(404, `no review "${round}": build its page first (reviews/${round}/index.html)`);
  return dir;
};

const loadFeedback = (reviews, round) => {
  const file = path.join(roundDir(reviews, round), 'feedback.json');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}';
};

const writeAtomic = (file, text) => {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
};

/** Writes the feedback atomically, keeping the previous copy at most once per BACKUP_EVERY_MS. A finished page is also copied to <workspace>/feedback/. */
const saveFeedback = ({ reviews, workspace }, round, data) => {
  const dir = roundDir(reviews, round);
  const file = path.join(dir, 'feedback.json');
  const prev = path.join(dir, 'feedback.prev.json');
  if (fs.existsSync(file)) {
    const lastBackup = fs.existsSync(prev) ? fs.statSync(prev).mtimeMs : 0;
    if (Date.now() - lastBackup > BACKUP_EVERY_MS) fs.copyFileSync(file, prev);
  }
  const { savedTo: _stale, ...fresh } = data;
  const savedAt = new Date().toISOString();
  const savedTo = data.submitted === true ? `feedback/${round}.json` : undefined;
  const saved = { ...fresh, round, savedAt, ...(savedTo ? { savedTo } : {}) };
  const text = JSON.stringify(saved, null, 2);
  writeAtomic(file, text);
  if (savedTo) {
    fs.mkdirSync(path.join(workspace, 'feedback'), { recursive: true });
    writeAtomic(path.join(workspace, savedTo), `${text}\n`);
  }
  return { savedAt, ...(savedTo ? { savedTo } : {}) };
};

/** Orders round ids so 02-map-10 comes after 02-map-2. */
export const byRound = (a, b) => a.localeCompare(b, 'en', { numeric: true });

/** 'not opened', 'in progress', 'finished' or 'feedback unreadable' for a round's live feedback file. */
export const feedbackState = (file) => {
  if (!fs.existsSync(file)) return 'not opened';
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).submitted ? 'finished' : 'in progress'; } catch { return 'feedback unreadable'; }
};

const indexPage = (reviews) => {
  const rounds = fs.existsSync(reviews)
    ? fs.readdirSync(reviews).filter((name) => ROUND.test(name) && fs.existsSync(path.join(reviews, name, 'index.html'))).sort(byRound).reverse()
    : [];
  const rows = rounds.map((name) => `<li><a href="/${name}/">${name}</a> <small>${feedbackState(path.join(reviews, name, 'feedback.json'))}</small></li>`);
  return '<!doctype html><meta charset="utf-8"><title>Reviews</title><link rel="stylesheet" href="/kit/review.css">'
    + '<header class="top"><p class="stage">Redesign</p><h1>Reviews</h1></header>'
    + `<main><ul class="plain">${rows.join('') || '<li>No review pages yet.</li>'}</ul></main>`;
};

/** The request handler. `allowed` is the set of Host values this server answers to. */
const handler = ({ reviews, workspace, assets, allowed, port }) => async (req, res) => {
  try {
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!allowed.has(host)) throw httpError(403, 'this server answers only on its own address');
    const url = new URL(req.url ?? '/', `http://${host}`);
    let route;
    try { route = decodeURIComponent(url.pathname); } catch { throw httpError(400, 'the address has a broken % escape'); }
    if (route.includes('//')) throw httpError(404, `nothing at ${url.pathname}`);

    const feedback = route.match(/^\/api\/feedback\/([^/]+)$/);
    if (feedback) {
      const round = feedback[1];
      if (req.method === 'GET') return send(res, 200, loadFeedback(reviews, round));
      if (req.method !== 'PUT') throw httpError(405, 'feedback takes GET or PUT');
      if (String(req.headers.origin ?? '').toLowerCase() !== `http://${host}`) throw httpError(403, 'feedback is saved only from the review page itself');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw httpError(415, 'send feedback as application/json');
      let data;
      try { data = JSON.parse(await readBody(req)); } catch (err) { throw err.status ? err : httpError(400, 'the feedback was not valid JSON; reload the page and try again'); }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw httpError(400, 'feedback must be a JSON object');
      return send(res, 200, JSON.stringify(saveFeedback({ reviews, workspace }, round, data)));
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'pages take GET only');
    if (route === '/health') return send(res, 200, JSON.stringify({ ok: true, port }));
    if (route === '/') return send(res, 200, indexPage(reviews), STATIC_TYPES['.html']);
    const kit = route.match(/^\/kit\/([^/]+)$/);
    const file = kit ? (KIT_FILES.has(kit[1]) && fs.existsSync(path.join(assets, kit[1])) ? path.join(assets, kit[1]) : null) : fileUnder(reviews, route.slice(1));
    if (!file) throw httpError(404, `nothing at ${route}`);
    if (!kit && !route.endsWith('/') && path.basename(file) === 'index.html' && !route.endsWith('index.html')) {
      res.writeHead(302, { Location: `${url.pathname}/` });
      return res.end();
    }
    return send(res, 200, fs.readFileSync(file), STATIC_TYPES[path.extname(file).toLowerCase()]);
  } catch (err) {
    const status = err.status ?? 500;
    if (status === 500) console.error(`review server: ${req.method} ${req.url}: ${err.stack ?? err}`);
    return send(res, status, JSON.stringify({ error: status === 500 ? 'the review server failed; its terminal has the detail' : err.message }));
  }
};

/** A review server over `reviews`, not yet listening. It answers only to this machine's loopback names on `port`. */
export const createReviewServer = ({ reviews, port, workspace, assets = ASSETS }) => {
  const root = path.resolve(reviews);
  const allowed = new Set([`${HOST}:${port}`, `localhost:${port}`]);
  return http.createServer(handler({ reviews: root, workspace: path.resolve(workspace ?? path.dirname(root)), assets: path.resolve(assets), allowed, port }));
};

const listenOn = (options, port) => new Promise((resolve, reject) => {
  const server = createReviewServer({ ...options, port });
  server.once('error', reject);
  server.listen(port, HOST, () => { server.removeListener('error', reject); resolve(server); });
});

/** Listens from `port`, skipping busy ports; resolves `{ server, port }`. */
export const listenOnFreePort = async ({ port = DEFAULT_PORT, tries = PORT_TRIES, ...options }) => {
  for (let attempt = 0; attempt < tries && port + attempt <= MAX_PORT; attempt += 1) {
    try { return { server: await listenOn(options, port + attempt), port: port + attempt }; } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`no free port from ${port} (tried ${tries}); stop another review server or pass --port`);
};

/** The recorded server in `<reviews>/.server.json`, or null when there is none. */
export const readServerRecord = (reviews) => {
  const file = path.join(reviews, '.server.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { throw new Error(`${file} is unreadable (${err.message}); delete it and start the server again`); }
};

/** True when a review server answers /health on `port`. */
export const checkHealth = (port) => new Promise((resolve) => {
  const req = http.get({ host: HOST, port, path: '/health', timeout: HEALTH_TIMEOUT_MS }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).ok === true); } catch { resolve(false); } });
  });
  req.on('timeout', () => req.destroy());
  req.on('error', () => resolve(false));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Re-runs this script detached, waits until its recorded server answers /health, and returns the address. */
const detach = async (argv, reviews) => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv.filter((a) => a !== '--detach')], { detached: true, stdio: 'ignore' });
  child.unref();
  const deadline = Date.now() + DETACH_WAIT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the review server exited with code ${child.exitCode}; run it without --detach to see why`);
    const record = fs.existsSync(path.join(reviews, '.server.json')) ? readServerRecord(reviews) : null;
    if (record?.pid === child.pid && await checkHealth(record.port)) return record.url;
    await sleep(100);
  }
  throw new Error(`the review server did not answer within ${DETACH_WAIT_MS / 1000} s; run it without --detach to see why`);
};

const main = async () => {
  const { flags } = parseFlags(process.argv.slice(2), FLAGS);
  const wanted = Number(flags['--port'] ?? process.env.REDESIGN_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(wanted) || wanted < MIN_PORT || wanted > MAX_PORT) throw new Error(`--port must be ${MIN_PORT} to ${MAX_PORT}, got "${flags['--port'] ?? process.env.REDESIGN_PORT}"`);
  const workspace = path.resolve(flags['--workspace'] ?? process.cwd());
  const reviews = path.resolve(workspace, flags['--dir'] ?? 'reviews');
  fs.mkdirSync(reviews, { recursive: true });
  if (flags['--detach']) { console.log(`review server: ${await detach(process.argv.slice(2), reviews)}`); return; }
  const { port } = await listenOnFreePort({ reviews, workspace, port: wanted });
  const url = `http://${HOST}:${port}/`;
  const record = path.join(reviews, '.server.json');
  fs.writeFileSync(record, JSON.stringify({ pid: process.pid, port, url, startedAt: new Date().toISOString() }, null, 2));
  const stop = () => { fs.rmSync(record, { force: true }); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log(`review server: ${url}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`review server: ${err.message}`); process.exit(1); });
}
