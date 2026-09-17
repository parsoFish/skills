// Extract the job catalogue: things that run on a schedule or on demand outside the request path.
// Sources, each read-only and offline: Makefile targets, package.json scripts whose name reads as a
// job, Kubernetes CronJob manifests, GitHub Actions `schedule` triggers, and in-process schedulers
// (`cron.schedule('<expr>', handler)`) in production code. Deterministic: sorted by source, file, id.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles, isTestPath } from './walk.mjs';

const JOB_SCRIPT_RE = /(^|[:_-])(jobs?|cron|nightly|daily|hourly|weekly|monthly|batch|scheduled?|worker|reindex|backfill)([:_-]|$)/i;
const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const CRON_CALL_RE = /\bcron\s*\.\s*schedule\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_$][\w$]*)?/g;

function makeTargets(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/);
    if (m && !line.startsWith('.')) out.push(m[1]);
  }
  return [...new Set(out)].sort();
}

function npmJobScripts(root) {
  const p = join(root, 'package.json');
  if (!existsSync(p)) return [];
  let pkg; try { pkg = JSON.parse(readFileSync(p, 'utf8')); } catch { return []; }
  return Object.entries(pkg.scripts ?? {}).filter(([name]) => JOB_SCRIPT_RE.test(name)).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, command]) => ({ source: 'npm-script', id, file: 'package.json', schedule: null, command: String(command) }));
}

function yamlValue(text, key) {
  const m = text.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+?)["']?\\s*(#.*)?$`, 'm'));
  return m ? m[1].trim() : null;
}

function k8sCronJobs(files, root) {
  const out = [];
  for (const rel of files) {
    const text = readFileSync(join(root, rel), 'utf8');
    if (!/^\s*kind:\s*CronJob\s*$/m.test(text)) continue;
    out.push({ source: 'k8s-cronjob', id: yamlValue(text, 'name') ?? rel, file: rel, schedule: yamlValue(text, 'schedule'), command: null });
  }
  return out;
}

function ghaSchedules(files, root) {
  const out = [];
  for (const rel of files.filter(f => f.startsWith('.github/workflows/'))) {
    const text = readFileSync(join(root, rel), 'utf8');
    const block = text.match(/^\s*schedule:\s*\n((?:\s+-\s*cron:.*\n?)+)/m);
    if (!block) continue;
    const name = yamlValue(text, 'name') ?? rel.replace(/^\.github\/workflows\//, '').replace(/\.ya?ml$/, '');
    for (const m of block[1].matchAll(/-\s*cron:\s*["']?([^"'\n#]+?)["']?\s*$/gm)) out.push({ source: 'gha-schedule', id: name, file: rel, schedule: m[1].trim(), command: null });
  }
  return out;
}

function inProcessSchedules(root, ignore) {
  const out = [];
  for (const rel of walkFiles(root, { ignore, exts: CODE_EXT })) {
    if (isTestPath(rel)) continue;
    let text; try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(CRON_CALL_RE)) out.push({ source: 'in-process', id: m[2] ?? `${rel}#${m[1]}`, file: rel, schedule: m[1], command: null });
  }
  return out;
}

/** Job catalogue across every runner the checkout shows. */
export function extractJobs(root, opts = {}) {
  const { ignore = [] } = opts;
  const notes = [];
  const jobs = [];
  const makefile = join(root, 'Makefile');
  if (existsSync(makefile)) jobs.push(...makeTargets(readFileSync(makefile, 'utf8')).map(id => ({ source: 'make', id, file: 'Makefile', schedule: null, command: id })));
  jobs.push(...npmJobScripts(root));
  const yamls = walkFiles(root, { ignore, exts: ['.yml', '.yaml'] }).sort();
  jobs.push(...k8sCronJobs(yamls, root));
  jobs.push(...ghaSchedules(yamls, root));
  jobs.push(...inProcessSchedules(root, ignore));
  if (!jobs.length) notes.push('no scheduled or catalogued jobs found (Makefile targets, job-named npm scripts, CronJob manifests, workflow schedules, cron.schedule calls)');
  const order = { 'gha-schedule': 0, 'k8s-cronjob': 1, 'in-process': 2, make: 3, 'npm-script': 4 };
  jobs.sort((a, b) => (order[a.source] - order[b.source]) || a.file.localeCompare(b.file) || a.id.localeCompare(b.id));
  return { jobs, notes };
}
