#!/usr/bin/env node
// Lint every skills/*/SKILL.md against the Agent Skills spec constraints plus house limits.
// Exit 1 on any error. Pure node, no deps.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export const LIMITS = { nameMax: 64, descriptionMax: 1024, skillMdMaxLines: 500, referenceMaxLines: 800 };

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { fields: null, body: text };
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fields, body: text.slice(m[0].length) };
}

export function lintSkill(dir) {
  const errors = [];
  const skillPath = join(dir, 'SKILL.md');
  const folder = basename(dir);
  if (!existsSync(skillPath)) return [`${folder}: missing SKILL.md`];
  const text = readFileSync(skillPath, 'utf8');
  const { fields, body } = parseFrontmatter(text);
  if (!fields) return [`${folder}: SKILL.md has no frontmatter`];
  if (!fields.name) errors.push(`${folder}: frontmatter.name missing`);
  else {
    if (fields.name !== folder) errors.push(`${folder}: name "${fields.name}" must equal folder name`);
    if (fields.name.length > LIMITS.nameMax) errors.push(`${folder}: name longer than ${LIMITS.nameMax}`);
    if (!/^[a-z0-9-]+$/.test(fields.name)) errors.push(`${folder}: name must be lowercase letters, digits, hyphens`);
  }
  if (!fields.description) errors.push(`${folder}: frontmatter.description missing`);
  else {
    if (fields.description.length > LIMITS.descriptionMax) errors.push(`${folder}: description longer than ${LIMITS.descriptionMax}`);
    if (/[<>]/.test(fields.description)) errors.push(`${folder}: description contains < or >`);
    if (!/\b(use when|use this|when the user|trigger)/i.test(fields.description)) errors.push(`${folder}: description should say when to use it (third person, trigger phrases)`);
  }
  const lines = text.split(/\r?\n/).length;
  if (lines > LIMITS.skillMdMaxLines) errors.push(`${folder}: SKILL.md is ${lines} lines (max ${LIMITS.skillMdMaxLines}); move detail to references/`);
  // relative links must resolve
  for (const m of body.matchAll(/\]\((?!https?:|#)([^)\s]+)\)/g)) {
    const target = join(dir, m[1].split('#')[0]);
    if (!existsSync(target)) errors.push(`${folder}: broken link ${m[1]}`);
  }
  const evals = join(dir, '..', '..', 'evals', folder);
  const hasCase = existsSync(evals) && readdirSync(evals).some(c => existsSync(join(evals, c, 'graders')) && readdirSync(join(evals, c, 'graders')).some(f => /type:\s*tool_used[\s\S]*tool:\s*Skill/.test(readFileSync(join(evals, c, 'graders', f), 'utf8'))));
  if (!hasCase) errors.push(`${folder}: no eval case under evals/${folder}/ with a tool_used: Skill grader (every skill needs one before it can pass the gate)`);
  const refs = join(dir, 'references');
  if (existsSync(refs)) for (const f of readdirSync(refs)) {
    const p = join(refs, f);
    if (statSync(p).isFile() && f.endsWith('.md')) {
      const n = readFileSync(p, 'utf8').split(/\r?\n/).length;
      if (n > LIMITS.referenceMaxLines) errors.push(`${folder}: references/${f} is ${n} lines (max ${LIMITS.referenceMaxLines})`);
    }
  }
  return errors;
}

export function walk(dir, out = []) { if (!existsSync(dir)) return out; for (const f of readdirSync(dir)) { const p = join(dir, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; }

/** Skills must not be tied to their author: forbidden terms (from lint.config.json) may not appear in skill or eval files. */
export function lintForbidden(root, config) {
  const terms = (config?.forbiddenTerms ?? []).map(t => t.toLowerCase());
  if (!terms.length) return [];
  const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
  const errors = [];
  for (const dir of config.scan ?? ['skills', 'evals']) for (const f of walk(join(root, dir))) {
    if (!/\.(md|json|c4|mjs|js|ts|yaml|yml|txt)$/.test(f)) continue;
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => { const m = l.match(re); if (m) errors.push(`${f.slice(root.length + 1)}:${i + 1}: forbidden term "${m[1]}" (skills must not reference the author's own projects)`); });
  }
  return errors;
}

export function lintAll(root) {
  const skillsDir = join(root, 'skills');
  const errors = [];
  for (const d of readdirSync(skillsDir)) {
    const p = join(skillsDir, d);
    if (statSync(p).isDirectory()) errors.push(...lintSkill(p));
  }
  const cfgPath = join(root, 'lint.config.json');
  if (existsSync(cfgPath)) errors.push(...lintForbidden(root, JSON.parse(readFileSync(cfgPath, 'utf8'))));
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = lintAll(process.cwd());
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('skills lint: ok');
}
