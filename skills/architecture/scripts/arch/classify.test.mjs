import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './classify.mjs';

function fakeFs(files) { return { exists: p => p in files, read: p => files[p], list: p => Object.keys(files).filter(f => f.startsWith(p === '.' ? '' : p + '/')).map(f => f.slice(p === '.' ? 0 : p.length + 1).split('/')[0]) }; }

test('terraform repo is iac', () => {
  const r = classify('/x', fakeFs({ 'main.tf': '', 'README.md': '' }));
  assert.deepEqual(r.kinds, ['iac']);
});
test('node cli with bin is cli', () => {
  const r = classify('/x', fakeFs({ 'package.json': JSON.stringify({ bin: { mdtoc: 'x.js' } }) }));
  assert.deepEqual(r.kinds, ['cli']); assert.equal(r.ambiguous, false);
});
test('next + ws monorepo is service, flagged ambiguous when also plugin host', () => {
  const r = classify('/x', fakeFs({ 'package.json': JSON.stringify({ workspaces: ['a'], dependencies: { next: '1', ws: '1' } }), 'skills/x/SKILL.md': '' }));
  assert.deepEqual(r.kinds, ['plugin', 'service']); assert.equal(r.ambiguous, true);
});
test('browser extension manifest', () => {
  const r = classify('/x', fakeFs({ 'manifest.json': JSON.stringify({ manifest_version: 3 }) }));
  assert.deepEqual(r.kinds, ['extension']);
});
test('python with gpio libs is hardware', () => {
  const r = classify('/x', fakeFs({ 'requirements.txt': 'rpi_ws281x\n' }));
  assert.deepEqual(r.kinds, ['hardware']);
});
