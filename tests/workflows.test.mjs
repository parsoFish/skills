import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// GitHub refuses a run outright when the workflow file fails to parse ("This run likely failed because of a
// workflow file issue") and nothing in the job log says why. Parse every workflow locally so the gate catches it.
// Resolved from import.meta.url, not process.cwd(), so `node --test tests/workflows.test.mjs` works from any cwd.
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
const REQUIRED_CHECKS = ['deterministic', 'attested'];

function parseYaml(text) {
  return execFileSync('python3', ['-c', 'import sys,yaml,json; print(json.dumps(yaml.safe_load(sys.stdin.read())))'], { input: text, encoding: 'utf8' });
}

function workflows() {
  return readdirSync(dir).filter(f => /\.ya?ml$/.test(f));
}

function parsedWorkflows() {
  return workflows().map(f => ({ file: f, parsed: JSON.parse(parseYaml(readFileSync(join(dir, f), 'utf8'))) }));
}

test('every GitHub workflow file is valid YAML with jobs', () => {
  const files = workflows();
  assert.ok(files.length > 0, 'no workflow files found');
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(parseYaml(text)); }, `${f} does not parse as YAML`);
    assert.ok(parsed && typeof parsed.jobs === 'object', `${f} has no jobs map`);
  }
});

test('workflow expressions never sit inside a flow-style mapping (YAML reads `${{` as a nested map)', () => {
  for (const f of workflows()) {
    const bad = readFileSync(join(dir, f), 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /:\s*\{[^}]*\$\{\{/.test(l));
    assert.deepEqual(bad.map(([n]) => n), [], `${f}: flow mapping containing \${{ on lines ${bad.map(([n]) => n).join(', ')}`);
  }
});

test('every `uses:` step is pinned to a full 40-hex commit SHA', () => {
  for (const f of workflows()) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n').map((l, i) => [i + 1, l.trim()]).filter(([, l]) => l.startsWith('- uses:') || l.startsWith('uses:'));
    assert.ok(lines.length > 0, `${f}: expected at least one uses: step`);
    for (const [n, line] of lines) {
      const m = line.match(/uses:\s*([^\s#@]+)@([^\s#]+)/);
      assert.ok(m, `${f}:${n}: could not parse a uses: reference from "${line}"`);
      const [, , ref] = m;
      assert.match(ref, /^[0-9a-f]{40}$/, `${f}:${n}: "${line}" is not pinned to a 40-hex commit SHA`);
    }
  }
});

test('no required check (deterministic, attested) carries a job-level `if`, and no workflow filters on `on.paths`', () => {
  for (const { file, parsed } of parsedWorkflows()) {
    // PyYAML's safe_load resolves the unquoted mapping key `on` as the boolean True (YAML 1.1's
    // on/off/yes/no bareword booleans), which json.dumps then renders as the string key "true" —
    // so the trigger block surfaces here as parsed.true, not parsed.on.
    const onBlock = parsed.on ?? parsed.true;
    const onPaths = onBlock && typeof onBlock === 'object'
      && Object.values(onBlock).some(v => v && typeof v === 'object' && ('paths' in v || 'paths-ignore' in v));
    assert.equal(onPaths, false, `${file}: has an on.paths(-ignore) filter — a required check filtered out at the workflow level stays pending forever`);
    for (const name of REQUIRED_CHECKS) {
      const job = parsed.jobs?.[name];
      if (!job) continue;
      assert.ok(!('if' in job), `${file}: required check "${name}" has a job-level if — it can end up never starting, wedging every PR`);
    }
  }
});
