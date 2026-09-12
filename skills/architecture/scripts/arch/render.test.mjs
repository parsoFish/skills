import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from './render.mjs';

function dirs() {
  const modelDir = mkdtempSync(join(tmpdir(), 'model-'));
  const outDir = mkdtempSync(join(tmpdir(), 'out-'));
  return { modelDir, outDir };
}

function fakeExec(calls, { pilOk = true, exportFiles = ['index.png', 'containers.png'] } = {}) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd === 'npx' && args.includes('validate')) return { status: 0, stdout: '', stderr: '' };
    if (cmd === 'npx' && args.includes('export')) {
      const outDir = args[args.indexOf('-o') + 1];
      for (const f of exportFiles) writeFileSync(join(outDir, f), 'fake-png');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'python3' && args[0] === '-c') return { status: pilOk ? 0 : 1, stdout: '', stderr: pilOk ? '' : 'no module' };
    if (cmd === 'python3' && args[0] === '-') return { status: 0, stdout: '', stderr: '' };
    throw new Error(`unexpected exec call: ${cmd} ${args.join(' ')}`);
  };
}

test('happy path: validates, exports, postprocesses, and lists sorted png basenames', () => {
  const { modelDir, outDir } = dirs();
  const calls = [];
  const result = render({ modelDir, outDir, exec: fakeExec(calls) });
  assert.deepEqual(result.views, ['containers.png', 'index.png']);
  assert.equal(result.validated, true);
  assert.equal(result.postprocessed, true);
  assert.deepEqual(result.notes, []);
  assert.equal(calls[0].cmd, 'npx');
  assert.ok(calls[0].args.includes('validate'));
  assert.ok(calls[1].args.includes('export'));
  assert.ok(calls[1].args.includes(modelDir));
  assert.equal(calls[2].cmd, 'python3');
  assert.equal(calls[3].args[0], '-');
  assert.match(calls[3].opts.input, /from PIL import Image/);
});

test('throws with stderr when validate fails, and never calls export', () => {
  const { modelDir, outDir } = dirs();
  const calls = [];
  const exec = (cmd, args) => { calls.push(cmd); return args.includes('validate') ? { status: 1, stdout: '', stderr: 'bad model' } : { status: 0, stdout: '', stderr: '' }; };
  assert.throws(() => render({ modelDir, outDir, exec }), /bad model/);
  assert.deepEqual(calls, ['npx']);
});

test('throws with stderr when export fails', () => {
  const { modelDir, outDir } = dirs();
  const exec = (cmd, args) => (args.includes('export') ? { status: 1, stdout: '', stderr: 'export broke' } : { status: 0, stdout: '', stderr: '' });
  assert.throws(() => render({ modelDir, outDir, exec }), /export broke/);
});

test('postprocess: false skips the PIL check entirely', () => {
  const { modelDir, outDir } = dirs();
  const calls = [];
  const result = render({ modelDir, outDir, exec: fakeExec(calls), postprocess: false });
  assert.equal(result.postprocessed, false);
  assert.ok(result.notes.some(n => /disabled/.test(n)));
  assert.ok(!calls.some(c => c.cmd === 'python3'));
});

test('missing PIL is a soft skip, not a throw', () => {
  const { modelDir, outDir } = dirs();
  const calls = [];
  const result = render({ modelDir, outDir, exec: fakeExec(calls, { pilOk: false }) });
  assert.equal(result.postprocessed, false);
  assert.ok(result.notes.some(n => /not available/.test(n)));
});

test('non-png files in outDir are excluded from views', () => {
  const { modelDir, outDir } = dirs();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'notes.txt'), 'x');
  const calls = [];
  const result = render({ modelDir, outDir, exec: fakeExec(calls, { exportFiles: ['a.png'] }) });
  assert.deepEqual(result.views, ['a.png']);
});

test('outDir exists after export regardless of postprocess outcome', () => {
  const { modelDir, outDir } = dirs();
  const calls = [];
  render({ modelDir, outDir, exec: fakeExec(calls) });
  assert.ok(existsSync(outDir));
});
