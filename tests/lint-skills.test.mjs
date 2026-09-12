import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintSkill, lintForbidden, matchesExcludePath, parseFrontmatter, LIMITS } from '../scripts/lint-skills.mjs';

function skill(name, fm, body = '# x\n', withEval = true) {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  const dir = join(root, 'skills', name); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\n${fm}\n---\n${body}`);
  if (withEval) { mkdirSync(join(root, 'evals', name, 'c1', 'graders'), { recursive: true }); writeFileSync(join(root, 'evals', name, 'c1', 'prompt.md'), 'p'); writeFileSync(join(root, 'evals', name, 'c1', 'graders', 'fired.md'), '---\ntype: tool_used\ntool: Skill\n---\n'); }
  return dir;
}

test('a skill without an eval case carrying a Skill grader is reported', () => {
  const dir = skill('lonely', 'name: lonely\ndescription: Use when needed.', '# x\n', false);
  assert.ok(lintSkill(dir).some(e => e.includes('no eval case')));
});

test('parseFrontmatter reads name and description', () => {
  const { fields } = parseFrontmatter('---\nname: a\ndescription: "Use when x"\n---\nbody');
  assert.equal(fields.name, 'a'); assert.equal(fields.description, 'Use when x');
});

test('valid skill passes', () => {
  const dir = skill('good-skill', 'name: good-skill\ndescription: Does a thing. Use when the user asks for the thing.');
  assert.deepEqual(lintSkill(dir), []);
});

test('name must match folder and be kebab-case', () => {
  const dir = skill('good-skill', 'name: Other\ndescription: Use when needed.');
  const errs = lintSkill(dir);
  assert.ok(errs.some(e => e.includes('must equal folder name')));
  assert.ok(errs.some(e => e.includes('lowercase')));
});

test('description must exist, avoid angle brackets, and say when to use', () => {
  const dir = skill('s', 'name: s\ndescription: <b>fancy</b>');
  const errs = lintSkill(dir);
  assert.ok(errs.some(e => e.includes('< or >')));
  assert.ok(errs.some(e => e.includes('when to use')));
});

test('SKILL.md line cap enforced', () => {
  const dir = skill('s', 'name: s\ndescription: Use when needed.', '# x\n'.repeat(LIMITS.skillMdMaxLines + 5));
  assert.ok(lintSkill(dir).some(e => e.includes('lines (max')));
});

test('broken relative links reported', () => {
  const dir = skill('s', 'name: s\ndescription: Use when needed.', 'see [ref](references/missing.md)\n');
  assert.ok(lintSkill(dir).some(e => e.includes('broken link')));
});

test('forbidden terms are reported with file and line, case-insensitive', () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  mkdirSync(join(root, 'skills', 's'), { recursive: true });
  writeFileSync(join(root, 'skills', 's', 'SKILL.md'), '---\nname: s\ndescription: Use when needed.\n---\nWorks great on Acme Corp repos.\n');
  const errs = lintForbidden(root, { forbiddenTerms: ['acme corp'], scan: ['skills'] });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /skills\/s\/SKILL.md:5: forbidden term "Acme Corp"/);
  assert.deepEqual(lintForbidden(root, { forbiddenTerms: [] }), []);
});

test('lintForbidden scan roots are pinned to skills+evals regardless of config.scan; .claude/skills is out of scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  mkdirSync(join(root, '.claude', 'skills', 's'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 's', 'SKILL.md'), '---\nname: s\ndescription: Use when needed.\n---\nAcme Corp lives here.\n');
  // an attempted override: even naming .claude/skills explicitly in config.scan must not widen the scan
  const errs = lintForbidden(root, { forbiddenTerms: ['acme corp'], scan: ['.claude/skills'] });
  assert.deepEqual(errs, []);
});

test('matchesExcludePath supports plain path prefixes and */** globs', () => {
  assert.equal(matchesExcludePath('evals/attest/x.json', ['evals/attest/**']), true);
  assert.equal(matchesExcludePath('evals/attest/x.json', ['evals/attest/']), true);
  assert.equal(matchesExcludePath('evals/ledger.md', ['evals/ledger.md']), true);
  assert.equal(matchesExcludePath('evals/ledger.md.bak', ['evals/ledger.md']), false);
  assert.equal(matchesExcludePath('evals/gate-eval-2.json', ['evals/gate-eval*.json']), true);
  assert.equal(matchesExcludePath('evals/architecture/c1/prompt.md', ['evals/attest/**', 'evals/results/**']), false);
});

test('lintForbidden excludes generated evidence/report paths via lint.config.json lintExcludePaths, but still catches the term in a real eval case', () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  mkdirSync(join(root, 'evals', 'attest'), { recursive: true });
  writeFileSync(join(root, 'evals', 'attest', 'x.json'), '{"plugin": "acme corp skills"}\n');
  mkdirSync(join(root, 'evals', 'architecture', 'c1'), { recursive: true });
  writeFileSync(join(root, 'evals', 'architecture', 'c1', 'prompt.md'), 'Document the acme corp repo.\n');
  const config = { forbiddenTerms: ['acme corp'], lintExcludePaths: ['evals/attest/**'] };
  const errs = lintForbidden(root, config);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /evals\/architecture\/c1\/prompt\.md/);
});
