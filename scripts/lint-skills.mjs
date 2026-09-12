#!/usr/bin/env node
// Lint every skills/*/SKILL.md against the Agent Skills spec constraints plus house limits.
// Exit 1 on any error. Pure node, no deps.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export const LIMITS = { nameMax: 64, descriptionMax: 1024, skillMdMaxLines: 500, referenceMaxLines: 800, scriptLineCap: 400, maxSkillBytes: 512000 };
// Pinned, not config-driven: forbidden-term scanning must never be pointed at .claude/ (which may
// legitimately name the author/repo) by an edited lint.config.json "scan" field.
const FORBIDDEN_SCAN_ROOTS = ['skills', 'evals'];
const NETWORK_RE = /\b(curl|wget|npm i|npm install|pip install|git clone)\b|https?:\/\//;
const FLAG_RE = /--[a-z][a-z0-9-]+/g;
const QUOTED_FLAG_RE = /['"](--[a-z][a-z0-9-]+)['"]/g;

/** true when `relPath` (root-relative, forward slashes) matches a glob (`*`/`**` = "anything",
 * including slashes) or a plain prefix from `patterns`. A bare literal matches only exactly or as a
 * directory prefix, so "evals/ledger.md" never also swallows "evals/ledger.md.bak". */
export function matchesExcludePath(relPath, patterns = []) {
  return patterns.some(p => {
    if (p.includes('*')) {
      const re = new RegExp(`^${p.replace(/\*+/g, '*').split('*').map(s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      return re.test(relPath);
    }
    return relPath === p || relPath.startsWith(p.endsWith('/') ? p : `${p}/`);
  });
}

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

/** Skills must not be tied to their author: forbidden terms (from lint.config.json) may not appear
 * in skill or eval files. Scan roots are pinned to FORBIDDEN_SCAN_ROOTS, not config.scan — a config
 * edit cannot widen this into .claude/ or anywhere else. `config.lintExcludePaths` (globs or plain
 * prefixes, root-relative) carves out generated run evidence — a real eval case under
 * evals/<skill>/<case>/** is never excludable this way, only the tool's own gate/report/evidence
 * output, which legitimately carries the plugin's own name. */
export function lintForbidden(root, config) {
  const terms = (config?.forbiddenTerms ?? []).map(t => t.toLowerCase());
  if (!terms.length) return [];
  const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
  const exclude = config?.lintExcludePaths ?? [];
  const errors = [];
  for (const dir of FORBIDDEN_SCAN_ROOTS) for (const f of walk(join(root, dir))) {
    if (!/\.(md|json|c4|mjs|js|ts|yaml|yml|txt)$/.test(f)) continue;
    const relPath = f.slice(root.length + 1);
    if (matchesExcludePath(relPath, exclude)) continue;
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => { const m = l.match(re); if (m) errors.push(`${relPath}:${i + 1}: forbidden term "${m[1]}" (skills must not reference the author's own projects)`); });
  }
  return errors;
}

/** No fixture.sh under evals/** may reach the network — an eval that needs it is an eval that fails
 * inside the sandbox. */
export function lintFixtureNetwork(root) {
  const errors = [];
  for (const f of walk(join(root, 'evals'))) {
    if (basename(f) !== 'fixture.sh') continue;
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => { if (NETWORK_RE.test(l)) errors.push(`${f.slice(root.length + 1)}:${i + 1}: fixture.sh references the network ("${l.trim()}") — evals must run offline in the sandbox`); });
  }
  return errors;
}

/** A skill directory (assets, references, scripts, evals excluded — evals live outside it) must
 * stay under config.maxSkillBytes / LIMITS.maxSkillBytes total. */
export function lintSkillSize(dir, config) {
  const max = config?.maxSkillBytes ?? LIMITS.maxSkillBytes;
  const total = walk(dir).reduce((sum, f) => sum + statSync(f).size, 0);
  return total > max ? [`${basename(dir)}: skill directory is ${total} bytes (max ${max})`] : [];
}

/** Every file under a skill's scripts/** stays at or under the owner's 400-line hard cap. */
export function lintScriptLineCap(dir) {
  const scriptsDir = join(dir, 'scripts');
  const folder = basename(dir);
  const errors = [];
  for (const f of walk(scriptsDir)) {
    const n = readFileSync(f, 'utf8').split(/\r?\n/).length;
    if (n > LIMITS.scriptLineCap) errors.push(`${folder}: ${f.slice(dir.length + 1)} is ${n} lines (max ${LIMITS.scriptLineCap})`);
  }
  return errors;
}

/** A SKILL.md or references/*.md must not claim a `--flag` its own kit CLI does not accept (the
 * `--github` ghost this caught: documented, never implemented). Docs-only tokens fail unless listed
 * in config.allowedFlags[<skill>] — reserved for flags of external tools the docs legitimately name. */
export function lintFlagClaims(dir, config) {
  const folder = basename(dir);
  const allowed = new Set(config?.allowedFlags?.[folder] ?? []);
  const docFiles = [join(dir, 'SKILL.md')];
  const refs = join(dir, 'references');
  if (existsSync(refs)) for (const f of readdirSync(refs)) if (f.endsWith('.md')) docFiles.push(join(refs, f));
  const docFlags = new Set();
  for (const f of docFiles) { if (!existsSync(f)) continue; for (const m of readFileSync(f, 'utf8').matchAll(FLAG_RE)) docFlags.add(m[0]); }
  const cliFlags = new Set();
  for (const f of walk(join(dir, 'scripts'))) {
    if (!f.endsWith('.mjs') || f.endsWith('.test.mjs')) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(QUOTED_FLAG_RE)) cliFlags.add(m[1]);
  }
  const errors = [];
  for (const flag of docFlags) {
    if (cliFlags.has(flag) || allowed.has(flag)) continue;
    errors.push(`${folder}: docs claim ${flag}, but no script under scripts/** accepts it (implement it, remove the claim, or add it to lint.config.json allowedFlags.${folder} if it names an external tool's flag)`);
  }
  return errors;
}

export function lintAll(root) {
  const skillsDir = join(root, 'skills');
  const cfgPath = join(root, 'lint.config.json');
  const config = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const errors = [];
  for (const d of readdirSync(skillsDir)) {
    const p = join(skillsDir, d);
    if (!statSync(p).isDirectory()) continue;
    errors.push(...lintSkill(p), ...lintSkillSize(p, config), ...lintScriptLineCap(p), ...lintFlagClaims(p, config));
  }
  errors.push(...lintForbidden(root, config), ...lintFixtureNetwork(root));
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = lintAll(process.cwd());
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('skills lint: ok');
}
