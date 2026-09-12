import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractDelivery } from './extract-delivery.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'delivery-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

const CI_YML = `name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Build
        run: |
          npm ci
          npm run build
  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;

test('parses name, triggers, jobs with needs/runs-on/steps, first line of a block run', () => {
  const root = project({ '.github/workflows/ci.yml': CI_YML });
  const r = extractDelivery(root);
  assert.equal(r.workflows.length, 1);
  const wf = r.workflows[0];
  assert.equal(wf.file, '.github/workflows/ci.yml');
  assert.equal(wf.name, 'CI');
  assert.deepEqual(wf.triggers, ['pull_request', 'push']);
  assert.deepEqual(wf.jobs.map(j => j.id), ['build', 'test']);
  const build = wf.jobs.find(j => j.id === 'build');
  assert.equal(build.runsOn, 'ubuntu-latest');
  assert.deepEqual(build.needs, []);
  assert.deepEqual(build.steps, [{ name: 'Checkout', uses: 'actions/checkout@v4' }, { name: 'Build', run: 'npm ci' }]);
  const t = wf.jobs.find(j => j.id === 'test');
  assert.deepEqual(t.needs, ['build']);
  assert.deepEqual(t.steps, [{ run: 'npm test' }]);
  assert.equal(r.requiredChecks, null);
});

test('inline on: scalar and inline needs list', () => {
  const root = project({ '.github/workflows/simple.yml': 'on: workflow_dispatch\njobs:\n  a:\n    runs-on: ubuntu-latest\n  b:\n    needs: [a]\n    runs-on: ubuntu-latest\n' });
  const r = extractDelivery(root);
  assert.deepEqual(r.workflows[0].triggers, ['workflow_dispatch']);
  assert.deepEqual(r.workflows[0].jobs.find(j => j.id === 'b').needs, ['a']);
});

test('multiple workflow files sorted by path', () => {
  const root = project({ '.github/workflows/b.yml': 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n', '.github/workflows/a.yaml': 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n' });
  const r = extractDelivery(root);
  assert.deepEqual(r.workflows.map(w => w.file), ['.github/workflows/a.yaml', '.github/workflows/b.yml']);
});

test('Makefile deploy/apply/plan targets become a jobs-only entry; other targets ignored', () => {
  const root = project({ Makefile: 'build:\n\t go build\n\ndeploy-prod:\n\t ./deploy.sh\n\nplan:\n\t terraform plan\n' });
  const r = extractDelivery(root);
  const mk = r.workflows.find(w => w.file === 'Makefile');
  assert.deepEqual(mk.jobs, [{ id: 'deploy-prod' }, { id: 'plan' }]);
});

test('missing workflows dir is noted, not thrown', () => {
  const root = project({ 'README.md': 'hi\n' });
  const r = extractDelivery(root);
  assert.deepEqual(r.workflows, []);
  assert.ok(r.notes.includes('no .github/workflows found'));
});

test('opts.ignore excludes .github/workflows from being scanned', () => {
  const root = project({ '.github/workflows/ci.yml': 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n' });
  const r = extractDelivery(root, { ignore: ['.github'] });
  assert.deepEqual(r.workflows, []);
  assert.ok(r.notes.includes('no .github/workflows found'));
});
