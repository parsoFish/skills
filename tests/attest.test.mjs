import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { skillsDigest, harnessDigest, dirtyPaths, copyEvidence, verify } from '../scripts/attest.mjs';
import { redactSuiteIdentity, redactHomePaths } from '../scripts/attest/evidence.mjs';
import { skillDigest } from '../scripts/attest/digest.mjs';

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function write(root, relPath, content) {
  const p = join(root, relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function initRepo() {
  const root = mkdtempSync(join(tmpdir(), 'attest-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'a@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  return root;
}

const CONFIG = { threshold: 0.8, minDelta: 0.25, maxCostUsd: 5, maxAttestationAgeDays: 30 };

function writeBaseline(root) {
  write(root, 'package.json', JSON.stringify({ name: 'x', version: '0.1.0' }));
  write(root, '.claude-plugin/plugin.json', JSON.stringify({ name: 'x', version: '0.1.0' }));
  write(root, 'CHANGELOG.md', '# Changelog\n\n## 0.1.0\n- initial\n');
  write(root, 'lint.config.json', JSON.stringify({ forbiddenTerms: [], scan: ['skills', 'evals'] }));
  write(root, 'gate.config.json', JSON.stringify(CONFIG));
}

/** A fully golden, self-consistent attested repo: one changed skill, one covered case, digests that
 * match, a fresh generatedAt, a version bump and a CHANGELOG line. verify() on this must be {ok:true}. */
function buildGolden() {
  const root = initRepo();
  writeBaseline(root);
  const baseSha = commit(root, 'chore: baseline');

  write(root, 'skills/demo/SKILL.md', '---\nname: demo\ndescription: use when testing\n---\ndo the thing\n');
  write(root, 'evals/demo/case1/prompt.md', 'do the thing');
  write(root, 'evals/demo/case1/case.yaml', 'schema_version: "1.1"\n');
  write(root, 'evals/demo/case1/graders/skill-fired.md', '---\ntype: tool_used\ntool: Skill\n---\nfired\n');
  write(root, '.claude-plugin/plugin.json', JSON.stringify({ name: 'x', version: '0.2.0' }));
  write(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n- feat(demo): add demo skill\n\n## 0.1.0\n- initial\n');
  const headSha = commit(root, 'feat(demo): add demo skill');

  write(root, 'evals/attest/case1.json', JSON.stringify({ cases: [{ name: 'case1', graders: [], arms: {} }] }));

  const now = new Date('2026-09-13T00:00:00.000Z');
  const report = {
    schema: 2, ok: true, attested: true, agenticRan: true, bypass: null,
    generatedAt: now.toISOString(), commit: headSha, claudeVersion: '2.1.269', pluginVersion: '0.2.0',
    scope: { skills: ['demo'], harness: false }, changed: ['demo'],
    steps: [{ name: 'lint', ok: true, detail: '' }],
    eval: { threshold: 0.8, minDelta: 0.25, cases: [{ name: 'case1', skill: 'demo', score: 1, scoreWithout: 0, delta: 1, partial: false, errors: [], turns: 10, costUsd: 0.1, durationSeconds: 20, model: 'claude-sonnet-5', judge: 'claude-haiku-4-5', exit: 0, evidence: 'evals/attest/case1.json' }] },
    review: { demo: { verdict: 'pass', findings: [], costUsd: 0.05 } },
    totals: { costUsd: 0.15, durationSeconds: 25 },
    skillsDigest: skillsDigest(root), harnessDigest: harnessDigest(root),
  };
  writeReportFile(root, report);
  return { root, baseSha, headSha, now, report };
}

function writeReportFile(root, report) {
  write(root, 'evals/gate-report.json', JSON.stringify(report));
}

function cloneReport(report) { return JSON.parse(JSON.stringify(report)); }

function verifyGolden(g, overrides = {}) {
  return verify(g.root, { base: g.baseSha, now: g.now, config: CONFIG, ...overrides });
}

// ---- digests ----

test('skillsDigest is stable across a clone (byte-for-byte from git blobs, not the filesystem)', () => {
  const root = initRepo();
  writeBaseline(root);
  write(root, 'skills/demo/SKILL.md', 'content');
  write(root, 'evals/demo/case1/prompt.md', 'do it');
  commit(root, 'init');
  const d1 = skillsDigest(root);
  const h1 = harnessDigest(root);

  const clone = mkdtempSync(join(tmpdir(), 'attest-clone-'));
  spawnSync('git', ['clone', '-q', root, clone]);
  const d2 = skillsDigest(clone);
  const h2 = harnessDigest(clone);

  assert.equal(d1, d2);
  assert.equal(h1, h2);
});

test('skillsDigest excludes attestation output paths (results, attest, gate-report, gate-eval, REPORT.md, ledger.md)', () => {
  const root = initRepo();
  writeBaseline(root);
  write(root, 'skills/demo/SKILL.md', 'content');
  commit(root, 'init');
  const before = skillsDigest(root);

  write(root, 'evals/attest/case1.json', '{}');
  write(root, 'evals/gate-report.json', '{}');
  write(root, 'evals/gate-eval-case1.json', '{}');
  write(root, 'evals/REPORT.md', 'x');
  write(root, 'evals/ledger.md', 'x');
  write(root, 'evals/results/case1/report.html', 'x');
  commit(root, 'add excluded outputs');
  const after = skillsDigest(root);

  assert.equal(before, after);
});

test('harnessDigest covers scripts/**/*.mjs (never *.test.mjs) plus the three config files, and changes when they do', () => {
  const root = initRepo();
  writeBaseline(root);
  write(root, 'scripts/gate.mjs', 'export const x = 1;');
  write(root, 'scripts/gate.test.mjs', 'test file, must not count');
  commit(root, 'init');
  const before = harnessDigest(root);

  write(root, 'scripts/gate.test.mjs', 'changed but excluded');
  commit(root, 'edit test file only');
  assert.equal(harnessDigest(root), before, 'a *.test.mjs edit must not move the harness digest');

  write(root, 'scripts/gate.mjs', 'export const x = 2;');
  commit(root, 'edit real harness file');
  assert.notEqual(harnessDigest(root), before, 'a real harness edit must move the digest');
});

test('dirtyPaths reports uncommitted changes under the guarded paths, excluding attestation outputs', () => {
  const root = initRepo();
  writeBaseline(root);
  write(root, 'skills/demo/SKILL.md', 'content');
  commit(root, 'init');
  assert.deepEqual(dirtyPaths(root), []);

  appendFileSync(join(root, 'skills/demo/SKILL.md'), '\nmore');
  write(root, 'evals/attest/case1.json', '{}'); // excluded, must not appear
  assert.deepEqual(dirtyPaths(root), ['skills/demo/SKILL.md']);
});

// ---- copyEvidence ----

test('copyEvidence strips every tracePath at any depth and returns a root-relative path', () => {
  const root = initRepo();
  const src = join(root, 'src-evidence.json');
  writeFileSync(src, JSON.stringify({
    cases: [{ name: 'c', arms: { with: [{ tracePath: '/tmp/x/trace.jsonl', score: 1 }], without: [{ tracePath: '/tmp/y/trace.jsonl', score: 0 }] } }],
  }));
  const rel = copyEvidence(root, 'c', src);
  assert.equal(rel, 'evals/attest/c.json');
  const copied = JSON.parse(readFileSync(join(root, rel), 'utf8'));
  assert.equal(JSON.stringify(copied).includes('tracePath'), false);
  assert.equal(copied.cases[0].arms.with[0].score, 1);
});

test('copyEvidence fails fast when the source evidence is missing', () => {
  const root = initRepo();
  assert.throws(() => copyEvidence(root, 'c', join(root, 'nope.json')), /missing/);
});

test('redactSuiteIdentity drops suite.root and reduces suite.plugins to a count, keeping the rest of suite', () => {
  const value = {
    suite: {
      root: '/home/dave/dev/skills', ablation: 'with-without', threshold: 0.8,
      plugins: [{ name: 'dave-skills', version: '0.1.0', path: '/home/dave/dev/skills' }],
    },
  };
  assert.deepEqual(redactSuiteIdentity(value), { suite: { ablation: 'with-without', threshold: 0.8, plugins: 1 } });
  assert.deepEqual(redactSuiteIdentity({ no: 'suite here' }), { no: 'suite here' }, 'a value with no suite is untouched');
});

test('redactHomePaths rewrites every string containing the given home directory to <root>, at any depth', () => {
  const value = {
    a: '/home/dave/dev/skills',
    nested: { b: 'prefix /home/dave/x suffix', c: 5, d: null },
    list: ['/home/dave/y', 'unrelated'],
  };
  const out = redactHomePaths(value, '/home/dave');
  assert.deepEqual(out, { a: '<root>/dev/skills', nested: { b: 'prefix <root>/x suffix', c: 5, d: null }, list: ['<root>/y', 'unrelated'] });
});

test('copyEvidence end to end: the copied file contains no absolute home path and no suite.plugins array', () => {
  // copyEvidence redacts against the real machine's homedir() (it takes no override), so the fixture
  // has to plant that same home directory to exercise the redaction — a hardcoded "/home/dave" would
  // never match on a machine whose home is something else.
  const home = homedir();
  const root = initRepo();
  const src = join(root, 'src-evidence.json');
  writeFileSync(src, JSON.stringify({
    claudeVersion: '2.1.269',
    suite: { root: `${home}/dev/skills`, ablation: 'with-without', plugins: [{ name: 'dave-skills', version: '0.1.0', path: `${home}/dev/skills` }] },
    cases: [{
      name: 'c',
      arms: {
        with: [{ tracePath: '/tmp/x/trace.jsonl', score: 1, graders: [{ name: 'g', passed: true, explanation: `saw ${home}/dev/skills/docs/x.md` }] }],
        without: [{ tracePath: '/tmp/y/trace.jsonl', score: 0 }],
      },
    }],
  }));
  const rel = copyEvidence(root, 'c', src);
  const text = readFileSync(join(root, rel), 'utf8');
  assert.equal(text.includes(home), false, 'no absolute home path should survive the copy');
  assert.equal(text.includes('tracePath'), false);
  const copied = JSON.parse(text);
  assert.equal(typeof copied.suite.plugins, 'number', 'suite.plugins must be reduced to a count, not an array');
  assert.equal(copied.suite.plugins, 1);
  assert.equal(copied.suite.root, undefined);
  assert.match(copied.cases[0].arms.with[0].graders[0].explanation, /<root>\/dev\/skills\/docs\/x\.md/);
});

// ---- verify(): the golden path ----

test('verify passes on a golden, self-consistent attested repo', () => {
  const g = buildGolden();
  assert.deepEqual(verifyGolden(g), { ok: true, reasons: [] });
});

// ---- verify(): one fixture per fixed reason string ----

test('reason: schema mismatch', () => {
  const g = buildGolden();
  writeReportFile(g.root, { ...cloneReport(g.report), schema: 1 });
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['schema mismatch'] });
});

test('reason: schema mismatch when the report file does not exist at all', () => {
  const g = buildGolden();
  spawnSync('rm', [join(g.root, 'evals', 'gate-report.json')]);
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['schema mismatch'] });
});

test('reason: not attested', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.attested = false; r.bypass = null;
  writeReportFile(g.root, r);
  const { reasons } = verifyGolden(g);
  assert.ok(reasons.includes('not attested'));
  assert.ok(!reasons.includes('bypass recorded'));
});

test('reason: agentic did not run', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.agenticRan = false;
  writeReportFile(g.root, r);
  assert.ok(verifyGolden(g).reasons.includes('agentic did not run'));
});

test('reason: bypass recorded', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.attested = false; r.agenticRan = false; r.bypass = 'cost cap reached';
  writeReportFile(g.root, r);
  const { reasons } = verifyGolden(g);
  assert.ok(reasons.includes('bypass recorded'));
  assert.ok(!reasons.includes('not attested'), 'bypass explains attested:false; it should not also fire not-attested');
});

test('reason: skillsDigest mismatch', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.skillsDigest = 'f'.repeat(64);
  writeReportFile(g.root, r);
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['skillsDigest mismatch'] });
});

test('reason: harnessDigest mismatch', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.harnessDigest = 'f'.repeat(64);
  writeReportFile(g.root, r);
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['harnessDigest mismatch'] });
});

test('reason: commit not an ancestor of HEAD — a commit on a live branch that is off HEAD\'s history', () => {
  const g = buildGolden();
  // A child of HEAD made with plumbing and pinned by a branch ref: it is reachable in this clone, is
  // not in HEAD's history, and the worktree (with its untracked evidence) is untouched.
  const tree = git(g.root, ['write-tree']);
  const side = git(g.root, ['commit-tree', tree, '-p', 'HEAD', '-m', 'side commit']);
  git(g.root, ['update-ref', 'refs/heads/side', side]);
  const r = cloneReport(g.report); r.commit = side;
  writeReportFile(g.root, r);
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['commit not an ancestor of HEAD'] });
});

test('a dangling commit object (a squash-merged branch whose ref is gone but whose object survives in reflog) is not judged; the digests carry the proof', () => {
  const g = buildGolden();
  const tree = git(g.root, ['write-tree']);
  const side = git(g.root, ['commit-tree', tree, '-p', 'HEAD', '-m', 'squashed-away branch tip']);
  const r = cloneReport(g.report); r.commit = side;
  writeReportFile(g.root, r);
  assert.deepEqual(verifyGolden(g), { ok: true, reasons: [] });
});

test('a commit this clone does not have (squash-merged branch) is not judged; the digests carry the proof', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.commit = '0'.repeat(40);
  writeReportFile(g.root, r);
  assert.deepEqual(verifyGolden(g), { ok: true, reasons: [] });
});

test('reason: commit not an ancestor of HEAD when the report names no commit at all', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); delete r.commit;
  writeReportFile(g.root, r);
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['commit not an ancestor of HEAD'] });
});

test('reason: changed skill not covered', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.changed = [];
  writeReportFile(g.root, r);
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['changed skill not covered'] });
});

test('reason: case not covered by the attestation', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.eval.cases = [];
  writeReportFile(g.root, r);
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['case not covered by the attestation'] });
});

test('reason: case below threshold', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.eval.cases[0].score = 0.5;
  writeReportFile(g.root, r);
  assert.ok(verifyGolden(g).reasons.includes('case below threshold'));
});

test('reason: case below minDelta', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.eval.cases[0].delta = 0.1;
  writeReportFile(g.root, r);
  assert.ok(verifyGolden(g).reasons.includes('case below minDelta'));
});

test('reason: case partial', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.eval.cases[0].partial = true;
  writeReportFile(g.root, r);
  assert.ok(verifyGolden(g).reasons.includes('case partial'));
});

test('reason: case errored', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.eval.cases[0].errors = ['boom'];
  writeReportFile(g.root, r);
  assert.ok(verifyGolden(g).reasons.includes('case errored'));
});

test('reason: review not passed', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.review.demo.verdict = 'fail';
  writeReportFile(g.root, r);
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['review not passed'] });
});

test('reason: attestation too old', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.generatedAt = new Date(g.now.getTime() - 40 * 86_400_000).toISOString();
  writeReportFile(g.root, r);
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['attestation too old'] });
});

test('reason: missing evidence', () => {
  const g = buildGolden();
  const r = cloneReport(g.report); r.eval.cases[0].evidence = 'evals/attest/nope.json';
  writeReportFile(g.root, r);
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['missing evidence'] });
});

test('reason: working tree dirty', () => {
  const g = buildGolden();
  appendFileSync(join(g.root, 'skills/demo/SKILL.md'), '\nuncommitted edit');
  assert.deepEqual(verifyGolden(g), { ok: false, reasons: ['working tree dirty'] });
});

test('reason: version not bumped', () => {
  const root = initRepo();
  writeBaseline(root);
  const baseSha = commit(root, 'chore: baseline');
  write(root, 'skills/demo/SKILL.md', 'content');
  write(root, 'evals/demo/case1/prompt.md', 'do it');
  write(root, 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n- feat(demo): add demo skill\n\n## 0.1.0\n- initial\n');
  // plugin.json is left at the base version on purpose: the bump never happened.
  const headSha = commit(root, 'feat(demo): add demo skill without a version bump');
  const now = new Date('2026-09-13T00:00:00.000Z');
  const report = {
    schema: 2, ok: true, attested: true, agenticRan: true, bypass: null,
    generatedAt: now.toISOString(), commit: headSha, claudeVersion: '2.1.269', pluginVersion: '0.1.0',
    changed: ['demo'],
    steps: [],
    eval: { threshold: 0.8, minDelta: 0.25, cases: [] },
    review: {},
    skillsDigest: skillsDigest(root), harnessDigest: harnessDigest(root),
  };
  writeReportFile(root, report);
  const { reasons } = verify(root, { base: baseSha, now, config: CONFIG });
  assert.ok(reasons.includes('version not bumped'));
  assert.ok(!reasons.includes('changelog not updated'));
});

test('reason: changelog not updated', () => {
  const root = initRepo();
  writeBaseline(root);
  const baseSha = commit(root, 'chore: baseline');
  write(root, 'skills/demo/SKILL.md', 'content');
  write(root, 'evals/demo/case1/prompt.md', 'do it');
  write(root, '.claude-plugin/plugin.json', JSON.stringify({ name: 'x', version: '0.2.0' }));
  // CHANGELOG.md is untouched: version bumped, but no line landed under Unreleased or a version heading.
  const headSha = commit(root, 'feat(demo): add demo skill, forget the changelog');
  const now = new Date('2026-09-13T00:00:00.000Z');
  const report = {
    schema: 2, ok: true, attested: true, agenticRan: true, bypass: null,
    generatedAt: now.toISOString(), commit: headSha, claudeVersion: '2.1.269', pluginVersion: '0.2.0',
    changed: ['demo'],
    steps: [],
    eval: { threshold: 0.8, minDelta: 0.25, cases: [] },
    review: {},
    skillsDigest: skillsDigest(root), harnessDigest: harnessDigest(root),
  };
  writeReportFile(root, report);
  const { reasons } = verify(root, { base: baseSha, now, config: CONFIG });
  assert.ok(reasons.includes('changelog not updated'));
  assert.ok(!reasons.includes('version not bumped'));
});

test('release-discipline checks are skipped entirely when the diff never touches skills/', () => {
  const root = initRepo();
  writeBaseline(root);
  const baseSha = commit(root, 'chore: baseline');
  write(root, 'README.md', 'unrelated doc change');
  const headSha = commit(root, 'docs: unrelated');
  const now = new Date('2026-09-13T00:00:00.000Z');
  const report = {
    schema: 2, ok: true, attested: true, agenticRan: true, bypass: null,
    generatedAt: now.toISOString(), commit: headSha, claudeVersion: '2.1.269', pluginVersion: '0.1.0',
    changed: [],
    steps: [],
    eval: { threshold: 0.8, minDelta: 0.25, cases: [] },
    review: {},
    skillsDigest: skillsDigest(root), harnessDigest: harnessDigest(root),
  };
  writeReportFile(root, report);
  assert.deepEqual(verify(root, { base: baseSha, now, config: CONFIG }), { ok: true, reasons: [] });
});

test('changedSkillNames never reads evals/attest or evals/results as a skill', async () => {
  const { changedSkillNames } = await import('../scripts/attest/git.mjs');
  assert.deepEqual(changedSkillNames(['evals/attest/a.json', 'evals/results/x/report.html'], ['architecture']), []);
  assert.deepEqual(changedSkillNames(['evals/architecture/c/prompt.md', 'evals/attest/a.json'], ['architecture']), ['architecture']);
});

test('diffNameOnly against the empty-tree sentinel lists every tracked file (two-dot), instead of failing on merge-base', async () => {
  const { diffNameOnly, EMPTY_TREE_SHA } = await import('../scripts/attest/git.mjs');
  const g = buildGolden();
  const all = diffNameOnly(g.root, EMPTY_TREE_SHA, 'HEAD');
  assert.ok(all.length > 0 && all.includes('.claude-plugin/plugin.json'), `expected tracked files, got ${all.length}`);
});

test('skillDigest covers one skill\'s own files and evals only: it moves when they change and stays put when another skill changes', () => {
  const root = initRepo();
  writeBaseline(root);
  write(root, 'skills/alpha/SKILL.md', 'a1');
  write(root, 'evals/alpha/case1/prompt.md', 'do a');
  write(root, 'skills/beta/SKILL.md', 'b1');
  commit(root, 'init');
  const alpha1 = skillDigest(root, 'alpha');
  const beta1 = skillDigest(root, 'beta');
  assert.notEqual(alpha1, beta1);

  write(root, 'skills/beta/SKILL.md', 'b2');
  write(root, 'evals/attest/case1.json', '{}');
  commit(root, 'change beta and an excluded output');
  assert.equal(skillDigest(root, 'alpha'), alpha1, 'alpha unaffected by beta or attestation outputs');
  assert.notEqual(skillDigest(root, 'beta'), beta1);

  write(root, 'evals/alpha/case1/prompt.md', 'do a differently');
  commit(root, 'change alpha eval');
  assert.notEqual(skillDigest(root, 'alpha'), alpha1, 'an eval change moves the skill digest');
});
