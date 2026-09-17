import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractJobs } from './extract-jobs.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'jobs-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

test('Makefile targets become make jobs; pattern rules, .PHONY and variable assignments do not', () => {
  const root = project({ Makefile: 'CC := gcc\n.PHONY: build nightly\nbuild:\n\tgo build\nnightly: build\n\t./nightly.sh\n%.o: %.c\n\t$(CC) $<\n' });
  const r = extractJobs(root);
  assert.deepEqual(r.jobs.map(j => [j.source, j.id, j.schedule]), [['make', 'build', null], ['make', 'nightly', null]]);
  assert.equal(r.jobs[1].file, 'Makefile');
});

test('package.json scripts whose name reads as a job are listed with their command; ordinary scripts are not', () => {
  const root = project({ 'package.json': JSON.stringify({ name: 'app', scripts: { build: 'tsc', 'job:reindex': 'node dist/reindex.js', nightly: 'node dist/nightly.js', 'cron-cleanup': 'node dist/cleanup.js', test: 'vitest' } }) });
  const r = extractJobs(root);
  assert.deepEqual(r.jobs.map(j => [j.source, j.id, j.command]), [
    ['npm-script', 'cron-cleanup', 'node dist/cleanup.js'],
    ['npm-script', 'job:reindex', 'node dist/reindex.js'],
    ['npm-script', 'nightly', 'node dist/nightly.js'],
  ]);
});

test('Kubernetes CronJob manifests and GitHub Actions schedule triggers carry their cron expression', () => {
  const root = project({
    'deploy/cleanup.yaml': 'apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: cleanup\nspec:\n  schedule: "0 3 * * *"\n  jobTemplate: {}\n',
    'deploy/svc.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: api\n',
    '.github/workflows/nightly.yml': 'name: nightly\non:\n  schedule:\n    - cron: "30 2 * * 1-5"\n  workflow_dispatch:\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run nightly\n',
  });
  const r = extractJobs(root);
  assert.deepEqual(r.jobs.map(j => [j.source, j.id, j.schedule, j.file]), [
    ['gha-schedule', 'nightly', '30 2 * * 1-5', '.github/workflows/nightly.yml'],
    ['k8s-cronjob', 'cleanup', '0 3 * * *', 'deploy/cleanup.yaml'],
  ]);
});

test('in-process schedulers (node-cron style cron.schedule / setInterval-free) are found in production code with their expression, tests excluded', () => {
  const root = project({
    'package.json': JSON.stringify({ name: 'app' }),
    'src/scheduler.ts': "import cron from 'node-cron'\ncron.schedule('*/15 * * * *', pollGithub)\ncron.schedule(\"0 * * * *\", () => recompute())\n",
    'tests/scheduler.test.ts': "cron.schedule('* * * * *', noop)\n",
  });
  const r = extractJobs(root);
  assert.deepEqual(r.jobs.map(j => [j.source, j.schedule, j.file]), [['in-process', '*/15 * * * *', 'src/scheduler.ts'], ['in-process', '0 * * * *', 'src/scheduler.ts']]);
  assert.equal(r.jobs[0].id, 'pollGithub');
});

test('a project with no job-runner signals reports an empty list and a note, never a throw', () => {
  const root = project({ 'package.json': JSON.stringify({ name: 'app', scripts: { build: 'tsc' } }), 'src/a.ts': 'export const a = 1\n' });
  const r = extractJobs(root);
  assert.deepEqual(r.jobs, []);
  assert.ok(r.notes.some(n => /no scheduled or catalogued jobs found/.test(n)));
});
