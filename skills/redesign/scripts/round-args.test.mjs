import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags } from './round-args.mjs';

const SPEC = { '--port': 'value', '--detach': 'bool', '--title': 'value' };

test('splits positionals from flags, with value and boolean flags', () => {
  const out = parseFlags(['new', '01-prd-1', '--title', 'The PRD', '--detach'], SPEC);
  assert.deepEqual(out.positionals, ['new', '01-prd-1']);
  assert.deepEqual(out.flags, { '--title': 'The PRD', '--detach': true });
});

test('accepts --flag=value', () => {
  assert.equal(parseFlags(['--port=7801'], SPEC).flags['--port'], '7801');
});

test('an unknown flag or a missing value is a plain sentence', () => {
  assert.throws(() => parseFlags(['--nope'], SPEC), /unknown flag --nope/);
  assert.throws(() => parseFlags(['--port'], SPEC), /--port needs a value/);
  assert.throws(() => parseFlags(['--port', '--detach'], SPEC), /--port needs a value/);
  assert.throws(() => parseFlags(['--detach=1'], SPEC), /--detach takes no value/);
});

test('does not mutate its input', () => {
  const argv = ['--port', '1'];
  parseFlags(argv, SPEC);
  assert.deepEqual(argv, ['--port', '1']);
});
