// Repo-wide hygiene: every tracked source file is genuinely text (no stray control bytes that make
// `git diff` render it as binary), and every script stays under the owner's 400-line hard cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TEXT_SOURCE = /\.(mjs|js|ts|md|json|ya?ml|c4|sh)$/;
const SCRIPT_DIR = /^scripts\/|^skills\/[^/]+\/scripts\//;
const SCRIPT_LINE_CAP = 400;

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}

/** Bytes 0x00-0x08 are the C0 control range below tab (0x09); nothing legitimate in a text source
 * file needs them, and a raw NUL there is exactly what made extract-terraform.mjs undiffable. */
function controlByteOffenders(path) {
  const buf = readFileSync(path);
  for (let i = 0; i < buf.length; i++) if (buf[i] < 0x09) return true;
  return false;
}

test('every tracked text-source file has no control byte below 0x09 (tab)', () => {
  const files = trackedFiles().filter(f => TEXT_SOURCE.test(f));
  assert.ok(files.length > 0, 'expected at least one tracked text-source file');
  const offenders = files.filter(f => controlByteOffenders(join(ROOT, f)));
  assert.deepEqual(offenders, [], `file(s) with a control byte below 0x09: ${offenders.join(', ')}`);
});

test('every script under scripts/** or skills/*/scripts/** is at most 400 lines', () => {
  const files = trackedFiles().filter(f => SCRIPT_DIR.test(f));
  assert.ok(files.length > 0, 'expected at least one tracked script file');
  const offenders = files
    .map(f => ({ f, lines: readFileSync(join(ROOT, f), 'utf8').split('\n').length }))
    .filter(({ lines }) => lines > SCRIPT_LINE_CAP);
  assert.deepEqual(offenders, [], `file(s) over ${SCRIPT_LINE_CAP} lines: ${offenders.map(o => `${o.f} (${o.lines})`).join(', ')}`);
});

/** tools.json is the single source of truth for a pinned tool version — a `<name>@<version>` literal
 * duplicated into production source would silently drift from it and break the kit's byte-identical-
 * rerun guarantee. Scoped to non-test sources: an integration test that pins the exact release it
 * probes against a real, offline-cached copy of the tool is a different concern from production code
 * choosing which version to shell out to, and is out of scope here. */
test('the dependency-cruiser and likec4 versions are pinned in exactly one place: tools.json', () => {
  const tools = JSON.parse(readFileSync(join(ROOT, 'tools.json'), 'utf8'));
  const files = trackedFiles().filter(f => TEXT_SOURCE.test(f) && f !== 'tools.json' && !f.endsWith('.test.mjs'));
  const offenders = [];
  for (const [name, version] of [['likec4', tools.likec4], ['dependency-cruiser', tools['dependency-cruiser']]]) {
    const needle = `${name}@${version}`;
    for (const f of files) if (readFileSync(join(ROOT, f), 'utf8').includes(needle)) offenders.push(`${f}: ${needle}`);
  }
  assert.deepEqual(offenders, [], `version literal(s) outside tools.json: ${offenders.join(', ')}`);
});
