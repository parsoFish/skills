// Docs-as-tests: the commands and links this repo's own docs tell an agent to run must actually
// exist. This test does not execute anything network-bound or paid — it asserts existence and
// naming parity only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DOC_FILES = ['CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'docs/gate-runbook.md'];

// The exact heading list from the shared stream contract (docs/roadmaps-style binding spec for
// this campaign): one `## <step>` per gate step, and one `### <reason>` per attest-verify reason,
// nested under `## attest verify`.
const RUNBOOK_STEP_HEADINGS = [
  'lint', 'tests', 'plugin validate --strict', 'skill-creator quick_validate',
  'eval case with Skill grader', 'claude plugin eval', 'structural review',
  'attest verify', 'version bump', 'gh pr checks',
];
const RUNBOOK_REASON_HEADINGS = [
  'schema mismatch', 'not attested', 'agentic did not run', 'bypass recorded',
  'skillsDigest mismatch', 'harnessDigest mismatch', 'commit not an ancestor of HEAD',
  'changed skill not covered', 'case not covered by the attestation', 'case below threshold',
  'case below minDelta', 'case partial', 'case errored', 'review not passed',
  'attestation too old', 'missing evidence', 'working tree dirty',
  'version not bumped', 'changelog not updated',
];

function readDoc(rel) { return readFileSync(join(ROOT, rel), 'utf8'); }

// \s+ (not a literal space) between the words: markdown line-wrapping can put a code span's
// contents across two source lines without changing how it renders.
function extractNpmRunNames(text) {
  return [...text.matchAll(/\bnpm run\s+([a-zA-Z0-9:_-]+)/g)].map(m => m[1]);
}

function extractScriptPaths(text) {
  return [...text.matchAll(/\bnode\s+scripts\/([\w./-]+\.mjs)/g)].map(m => m[1]);
}

function extractRelativeLinks(text) {
  return [...text.matchAll(/\]\(([^)]+)\)/g)]
    .map(m => m[1])
    .filter(link => link && !/^(https?:|mailto:|#)/.test(link));
}

test('every `npm run <x>` referenced in CLAUDE.md/README/CONTRIBUTING/runbook exists in package.json scripts', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const scripts = pkg.scripts ?? {};
  const missing = new Set();
  for (const doc of DOC_FILES) for (const name of extractNpmRunNames(readDoc(doc))) {
    if (!(name in scripts)) missing.add(`${doc}: npm run ${name}`);
  }
  assert.deepEqual([...missing], [], `referenced but missing from package.json scripts: ${[...missing].join(', ')}`);
});

test('every `node scripts/<f>.mjs` named in the docs exists on disk', () => {
  const missing = new Set();
  for (const doc of DOC_FILES) for (const p of extractScriptPaths(readDoc(doc))) {
    if (!existsSync(join(ROOT, 'scripts', p))) missing.add(`${doc}: scripts/${p}`);
  }
  assert.deepEqual([...missing], [], `node scripts/<f>.mjs referenced but missing: ${[...missing].join(', ')}`);
});

test('every relative link in the docs resolves to a real file', () => {
  const broken = [];
  for (const doc of DOC_FILES) {
    const dir = dirname(join(ROOT, doc));
    for (const link of extractRelativeLinks(readDoc(doc))) {
      const target = join(dir, link.split('#')[0]);
      if (!existsSync(target)) broken.push(`${doc} -> ${link}`);
    }
  }
  assert.deepEqual(broken, [], `broken relative links: ${broken.join(', ')}`);
});

test('the gate runbook covers every contract step heading', () => {
  const text = readDoc('docs/gate-runbook.md');
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].trim());
  const missing = RUNBOOK_STEP_HEADINGS.filter(h => !headings.includes(h));
  assert.deepEqual(missing, [], `missing "## <step>" headings in the runbook: ${missing.join(', ')}`);
});

test('the gate runbook covers every attest-verify reason, nested under "## attest verify"', () => {
  const text = readDoc('docs/gate-runbook.md');
  const attestHeading = /^##\s+attest verify\s*$/m.exec(text);
  assert.ok(attestHeading, 'missing "## attest verify" section');
  const rest = text.slice(attestHeading.index + attestHeading[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const reasons = [...section.matchAll(/^###\s+(.+)$/gm)].map(m => m[1].trim());
  const missing = RUNBOOK_REASON_HEADINGS.filter(h => !reasons.includes(h));
  assert.deepEqual(missing, [], `missing "### <reason>" headings under attest verify: ${missing.join(', ')}`);
});

test('CLAUDE.md stays at or under 120 lines', () => {
  const lineCount = readDoc('CLAUDE.md').split('\n').length;
  assert.ok(lineCount <= 120, `CLAUDE.md is ${lineCount} lines, over the 120-line cap`);
});

test('npm run validate targets the marketplace manifest, not the plugin root', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts?.validate?.includes('plugin validate .'), '"validate" script should run `claude plugin validate .`');
});
