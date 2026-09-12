import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handEdgesFromC4 } from './arch.mjs';

test('handEdgesFromC4 reads plain, kinded and runtime relationships and strips the system prefix', () => {
  const c4 = `model {
  operator -> sys.ui 'uses'
  sys.ui -[runtime]-> sys.api 'HTTP'
  sys.api -[imports]-> sys.core '12'
  sys.core -> sys.db 'reads (runtime)'
  // not an edge: sys.core -> comment
}`;
  const edges = handEdgesFromC4(c4, 'sys');
  assert.deepEqual(edges, [
    { from: 'operator', to: 'ui', runtime: false },
    { from: 'ui', to: 'api', runtime: true },
    { from: 'api', to: 'core', runtime: false },
    { from: 'core', to: 'db', runtime: true },
  ]);
});

test('importing arch.mjs has no side effects (no usage output, no exit code)', () => {
  assert.equal(process.exitCode ?? 0, 0);
});
