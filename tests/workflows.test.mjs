import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// GitHub refuses a run outright when the workflow file fails to parse ("This run likely failed because of a
// workflow file issue") and nothing in the job log says why. Parse every workflow locally so the gate catches it.
const dir = join(process.cwd(), '.github', 'workflows');

function parseYaml(text) {
  return execFileSync('python3', ['-c', 'import sys,yaml,json; print(json.dumps(yaml.safe_load(sys.stdin.read())))'], { input: text, encoding: 'utf8' });
}

test('every GitHub workflow file is valid YAML with jobs', () => {
  const files = readdirSync(dir).filter(f => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0, 'no workflow files found');
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(parseYaml(text)); }, `${f} does not parse as YAML`);
    assert.ok(parsed && typeof parsed.jobs === 'object', `${f} has no jobs map`);
  }
});

test('workflow expressions never sit inside a flow-style mapping (YAML reads `${{` as a nested map)', () => {
  for (const f of readdirSync(dir).filter(f => /\.ya?ml$/.test(f))) {
    const bad = readFileSync(join(dir, f), 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /:\s*\{[^}]*\$\{\{/.test(l));
    assert.deepEqual(bad.map(([n]) => n), [], `${f}: flow mapping containing \${{ on lines ${bad.map(([n]) => n).join(', ')}`);
  }
});
