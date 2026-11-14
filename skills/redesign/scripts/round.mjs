#!/usr/bin/env node
// Runs a review round from the command line. Every verb takes --workspace <dir> (default: the current folder).
// The workspace holds reviews/<round>/, feedback/<round>.json, DECISIONS.md and STATE.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseFlags } from './round-args.mjs';
import { buildTemplate } from './round-template.mjs';
import { summarize, formatAnswers } from './round-answers.mjs';
import { nextNumber, formatRow, appendRows, parseDecisionInput } from './round-decide.mjs';
import { readServerRecord, checkHealth, feedbackState, byRound } from './serve.mjs';

export { nextNumber, formatRow, appendRows };

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const ROUND_ID = /^\d{2}-[a-z][a-z0-9]*-\d+$/;
const WAIT_TIMEOUT_S = 3600;
const WAIT_EVERY_S = 2;
const TIMEOUT_EXIT = 2;
const OPENERS = [['xdg-open', []], ['open', []], ['cmd.exe', ['/c', 'start', '']], ['cmd', ['/c', 'start', '']]];

export const USAGE = `usage:
  node round.mjs new <round> [--title "..."] [--stage N] [--workspace <dir>]
  node round.mjs build <round> [--workspace <dir>]
  node round.mjs open <round> [--no-browser] [--workspace <dir>]
  node round.mjs wait <round> [--timeout <seconds>] [--every <seconds>] [--workspace <dir>]
  node round.mjs answers <round> [--json] [--workspace <dir>]
  node round.mjs decide [--file <decisions.json>] [--date YYYY-MM-DD] [--workspace <dir>]   (JSON array on stdin when no --file)
  node round.mjs status [--json] [--workspace <dir>]
<round> is <two-digit stage>-<name>-<number>, for example 02-map-1.`;

const FLAGS = {
  '--workspace': 'value', '--title': 'value', '--stage': 'value', '--timeout': 'value', '--every': 'value',
  '--file': 'value', '--date': 'value', '--json': 'bool', '--no-browser': 'bool', '--help': 'bool',
};

export const validateRound = (id) => {
  if (!ROUND_ID.test(id ?? '')) throw new Error(`"${id ?? ''}" is not a round id: use <two-digit stage>-<name>-<number>, such as 02-map-1`);
  return id;
};

const paths = (workspace, round) => ({
  reviews: path.join(workspace, 'reviews'),
  dir: round ? path.join(workspace, 'reviews', round) : undefined,
  live: round ? path.join(workspace, 'reviews', round, 'feedback.json') : undefined,
  kept: round ? path.join(workspace, 'feedback', `${round}.json`) : undefined,
});

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { throw new Error(`${file} could not be read as JSON: ${err.message}`); }
};

const needRound = (positionals) => validateRound(positionals[0]);
const seconds = (flags, name, fallback) => {
  const n = Number(flags[name] ?? fallback);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a number of seconds above 0, got "${flags[name]}"`);
  return n;
};

/** `Stage N · name` from a round id, with N optionally overridden. */
export const stageLabel = (round, override) => {
  const [stage, name] = round.split('-');
  const n = override === undefined ? Number(stage) : Number(override);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--stage must be a whole number, got "${override}"`);
  return `Stage ${n} · ${name}`;
};

const REVIEWS_IGNORE = ['*/index.html', '*/feedback.json', '*/feedback.prev.json', '*/_shots/', '.server.json', ''].join('\n');

const cmdNew = ({ positionals, flags, workspace }) => {
  const round = needRound(positionals);
  const { reviews, dir } = paths(workspace, round);
  if (fs.existsSync(dir)) throw new Error(`round ${round} already exists at ${dir}; pick the next number or edit its build.mjs`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'build.mjs'), buildTemplate({ round, title: flags['--title'] ?? round, stage: stageLabel(round, flags['--stage']) }));
  fs.writeFileSync(path.join(reviews, '.kit'), `${SCRIPTS}\n`);
  // Generated pages, shots and the live autosave are rebuilt or re-entered; only build.mjs and the
  // committed feedback/ copy are the record. Written once so a project's own rules can edit it.
  const ignore = path.join(reviews, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, REVIEWS_IGNORE);
  console.log(`created reviews/${round}/build.mjs; edit it, then: node round.mjs build ${round}`);
  return 0;
};

const cmdBuild = ({ positionals, workspace }) => {
  const round = needRound(positionals);
  const script = path.join(paths(workspace, round).dir, 'build.mjs');
  if (!fs.existsSync(script)) throw new Error(`no build script at ${script}; create the round with: node round.mjs new ${round}`);
  const run = spawnSync(process.execPath, [script], { cwd: workspace, stdio: 'inherit', env: { ...process.env, REDESIGN_KIT: process.env.REDESIGN_KIT ?? SCRIPTS } });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`the build of ${round} failed (exit ${run.status}); the message above says why`);
  return 0;
};

const findOnPath = (name, env = process.env) => {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  return (env.PATH ?? '').split(path.delimiter).filter(Boolean).some((d) => exts.some((e) => fs.existsSync(path.join(d, name + e))));
};

/** The command that opens a URL on this system: first of xdg-open, open, cmd, per what `has` finds; null if none. */
export const openerFor = ({ platform = process.platform, has = findOnPath } = {}) => {
  const order = platform === 'win32' ? [OPENERS[3], OPENERS[2]] : platform === 'darwin' ? [OPENERS[1], OPENERS[0]] : [OPENERS[0], OPENERS[1], OPENERS[2]];
  const found = order.find(([name]) => has(name));
  return found ? { command: found[0], args: found[1] } : null;
};

const startServer = (workspace) => {
  const run = spawnSync(process.execPath, [path.join(SCRIPTS, 'serve.mjs'), '--detach', '--workspace', workspace], { encoding: 'utf8' });
  const url = /review server: (\S+)/.exec(run.stdout ?? '')?.[1];
  if (run.status !== 0 || !url) throw new Error(`could not start the review server: ${(run.stderr || run.stdout || 'no output').trim()}`);
  return url;
};

/** The running server's address for this workspace, starting one if none answers. */
const ensureServer = async (workspace) => {
  const record = readServerRecord(paths(workspace).reviews);
  if (record && await checkHealth(record.port)) return record.url;
  return startServer(workspace);
};

const cmdOpen = async ({ positionals, flags, workspace }) => {
  const round = needRound(positionals);
  if (!fs.existsSync(path.join(paths(workspace, round).dir, 'index.html'))) throw new Error(`round ${round} has no page yet; build it first: node round.mjs build ${round}`);
  const address = `${await ensureServer(workspace)}${round}/`;
  console.log(address);
  if (flags['--no-browser'] || process.env.REDESIGN_NO_BROWSER === '1') return 0;
  const opener = openerFor();
  if (!opener) { console.log('no browser opener found; open the address above yourself'); return 0; }
  const child = spawn(opener.command, [...opener.args, address], { detached: true, stdio: 'ignore' });
  child.on('error', (err) => console.error(`could not open a browser (${err.message}); open the address above yourself`));
  child.unref();
  return 0;
};

/** Polls `file` until it holds `submitted: true`. Resolves the parsed feedback, or null after `timeoutMs`. */
export const waitForSubmit = async ({ file, timeoutMs, everyMs, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) => {
  const deadline = now() + timeoutMs;
  for (;;) {
    if (fs.existsSync(file)) {
      let data = null;
      try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = null; } // a half-written read: the next poll sees the whole file
      if (data?.submitted === true) return data;
    }
    if (now() >= deadline) return null;
    await sleep(everyMs);
  }
};

const cmdWait = async ({ positionals, flags, workspace }) => {
  const round = needRound(positionals);
  const { dir, live } = paths(workspace, round);
  if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error(`round ${round} has no page yet; build it first: node round.mjs build ${round}`);
  const timeout = seconds(flags, '--timeout', WAIT_TIMEOUT_S);
  const every = seconds(flags, '--every', WAIT_EVERY_S);
  const data = await waitForSubmit({ file: live, timeoutMs: timeout * 1000, everyMs: every * 1000 });
  if (!data) { console.error(`timed out after ${timeout} s: ${round} is not finished yet`); return TIMEOUT_EXIT; }
  console.log(formatAnswers(summarize(data)));
  return 0;
};

const cmdAnswers = ({ positionals, flags, workspace }) => {
  const round = needRound(positionals);
  const { live, kept } = paths(workspace, round);
  const file = [kept, live].find((f) => fs.existsSync(f));
  if (!file) throw new Error(`no answers for ${round}: neither feedback/${round}.json nor reviews/${round}/feedback.json exists yet`);
  const summary = summarize(readJson(file));
  console.log(flags['--json'] ? JSON.stringify(summary, null, 2) : formatAnswers(summary));
  return 0;
};

const readStdin = () => {
  if (process.stdin.isTTY) throw new Error('give the decisions as a JSON array on stdin or with --file <path>');
  return fs.readFileSync(0, 'utf8');
};

const localDate = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');

const cmdDecide = ({ flags, workspace }, today = () => new Date()) => {
  const date = flags['--date'] ?? localDate(today());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date must be YYYY-MM-DD, got "${date}"`);
  const rows = parseDecisionInput(flags['--file'] ? fs.readFileSync(flags['--file'], 'utf8') : readStdin()).map((r) => ({ ...r, date }));
  const file = path.join(workspace, 'DECISIONS.md');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const first = nextNumber(before);
  fs.writeFileSync(file, appendRows(before, rows));
  console.log(`recorded decisions ${rows.map((_, i) => first + i).join(', ')} in DECISIONS.md`);
  return 0;
};

/** The newest round folder under `reviews`, or null. */
export const lastRound = (reviews) => {
  if (!fs.existsSync(reviews)) return null;
  return fs.readdirSync(reviews).filter((n) => ROUND_ID.test(n)).sort(byRound).at(-1) ?? null;
};

const cmdStatus = async ({ flags, workspace }) => {
  const { reviews } = paths(workspace);
  const record = readServerRecord(reviews);
  const alive = record ? await checkHealth(record.port) : false;
  const round = lastRound(reviews);
  const decisions = path.join(workspace, 'DECISIONS.md');
  const state = path.join(workspace, 'STATE.md');
  const heading = fs.existsSync(state) ? fs.readFileSync(state, 'utf8').split('\n').find((l) => /^#+\s/.test(l)) : undefined;
  const report = {
    server: alive ? { running: true, url: record.url, pid: record.pid } : { running: false, stale: Boolean(record) },
    lastRound: round ? { round, state: feedbackState(paths(workspace, round).live) } : null,
    highestDecision: fs.existsSync(decisions) ? nextNumber(fs.readFileSync(decisions, 'utf8')) - 1 : 0,
    state: heading?.replace(/^#+\s*/, '') ?? null,
  };
  if (flags['--json']) { console.log(JSON.stringify(report, null, 2)); return 0; }
  console.log(`server: ${alive ? `running at ${record.url} (pid ${record.pid})` : record ? 'not running (a stale .server.json is left; the next open replaces it)' : 'not running'}`);
  console.log(`last round: ${round ? `${round} (${report.lastRound.state})` : 'none yet'}`);
  console.log(`decisions: ${report.highestDecision ? `highest number ${report.highestDecision}` : 'none recorded'}`);
  console.log(`STATE.md: ${report.state ?? 'no heading found'}`);
  return 0;
};

const VERBS = { new: cmdNew, build: cmdBuild, open: cmdOpen, wait: cmdWait, answers: cmdAnswers, decide: cmdDecide, status: cmdStatus };

/** Runs one verb for `argv`; resolves the exit code. */
export const run = async (argv) => {
  const { positionals, flags } = parseFlags(argv, FLAGS);
  const [verb, ...rest] = positionals;
  if (!verb || flags['--help']) { console.log(USAGE); return verb || flags['--help'] ? 0 : 1; }
  if (!VERBS[verb]) throw new Error(`unknown verb "${verb}"\n${USAGE}`);
  return VERBS[verb]({ positionals: rest, flags, workspace: path.resolve(flags['--workspace'] ?? process.cwd()) });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(`round: ${err.message}`); process.exit(1); });
}
