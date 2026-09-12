import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintSkill, lintForbidden, parseFrontmatter, LIMITS } from '../scripts/lint-skills.mjs';

function skill(name, fm, body = '# x\n') {
  const root = mkdtempSync(join(tmpdir(), 'skill-'));
  const dir = join(root, name); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\n${fm}\n---\n${body}`);
  return dir;
}

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
