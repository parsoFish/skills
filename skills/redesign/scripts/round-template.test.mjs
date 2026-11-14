import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTemplate } from './round-template.mjs';
import { fakeKit } from './round-fixtures.test.mjs';

test('the template is plain JavaScript that quotes its inputs safely', () => {
  const src = buildTemplate({ round: '01-prd-1', title: 'A "quoted" \\ title', stage: 'Stage 1 · prd' });
  assert.match(src, /REDESIGN_KIT/);
  assert.match(src, /reviews\/\.kit|'\.\.', '\.kit'/);
  assert.match(src, /render\.mjs/);
  assert.match(src, /blocks\.mjs/);
  assert.match(src, /counts\(/);
  assert.ok(src.includes(JSON.stringify('A "quoted" \\ title')));
});

test('run against a kit, the template writes index.html next to itself and logs the counts', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'redesign-tpl-'));
  try {
    const kit = fakeKit(ws);
    const round = path.join(ws, 'reviews', '01-prd-1');
    fs.mkdirSync(round, { recursive: true });
    fs.writeFileSync(path.join(round, 'build.mjs'), buildTemplate({ round: '01-prd-1', title: 'The PRD', stage: 'Stage 1 · prd' }));
    const run = spawnSync(process.execPath, [path.join(round, 'build.mjs')], { cwd: ws, encoding: 'utf8', env: { ...process.env, REDESIGN_KIT: kit } });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /01-prd-1: 1 ask, 0 items, 1 figure/);
    const html = fs.readFileSync(path.join(round, 'index.html'), 'utf8');
    assert.match(html, /<title>The PRD<\/title>/);
    assert.match(html, /Stage 1 · prd/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('without REDESIGN_KIT the template reads reviews/.kit', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'redesign-tpl-'));
  try {
    const kit = fakeKit(ws);
    fs.mkdirSync(path.join(ws, 'reviews', '01-prd-1'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'reviews', '.kit'), `${kit}\n`);
    fs.writeFileSync(path.join(ws, 'reviews', '01-prd-1', 'build.mjs'), buildTemplate({ round: '01-prd-1', title: 'T', stage: 'S' }));
    const env = { ...process.env };
    delete env.REDESIGN_KIT;
    const run = spawnSync(process.execPath, [path.join(ws, 'reviews', '01-prd-1', 'build.mjs')], { cwd: os.tmpdir(), encoding: 'utf8', env });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(fs.existsSync(path.join(ws, 'reviews', '01-prd-1', 'index.html')));
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
