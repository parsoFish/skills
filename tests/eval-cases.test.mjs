// Static lint over every eval case's files — no case is actually run here. Catches grader shapes
// that would pass regardless of whether the skill under test did anything: a regex whose pattern
// is just the prompt echoed back, a regex silently grading the chat transcript instead of a
// produced file, a case whose only grader is the `tool_used: Skill` fire-indicator (so its delta
// is structurally 0), and a fixture.sh that reaches the network and will fail unpredictably
// inside the eval sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const EVALS_DIR = join(ROOT, 'evals');

const NETWORK_RE = /\b(curl|wget|npm i|npm install|pip install|git clone)\b|https?:\/\//i;

/** Every case dir evals/<skill>/<case>/ that holds a prompt.md or case.yaml. Pure, sorted. */
export function listCases(root = EVALS_DIR) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const skill of readdirSync(root)) {
    const skillDir = join(root, skill);
    if (!statSync(skillDir).isDirectory()) continue;
    for (const name of readdirSync(skillDir)) {
      const dir = join(skillDir, name);
      if (!statSync(dir).isDirectory()) continue;
      if (existsSync(join(dir, 'prompt.md')) || existsSync(join(dir, 'case.yaml'))) out.push({ skill, name, dir });
    }
  }
  return out.sort((a, b) => `${a.skill}/${a.name}`.localeCompare(`${b.skill}/${b.name}`));
}

/** Split a leading `---\n...\n---\n` frontmatter block from the rest of the file. */
export function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return m ? { frontmatter: m[1], body: text.slice(m[0].length) } : { frontmatter: '', body: text };
}

/** One frontmatter value: unwraps a quoted scalar or an inline `{ k: v, k2: v2 }` flow mapping.
 * Good enough for this repo's grader/case frontmatter; not a general YAML parser. */
function parseValue(raw) {
  const v = raw.trim();
  if (/^\{[\s\S]*\}$/.test(v)) {
    const out = {};
    for (const part of v.slice(1, -1).split(',')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      out[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
    return out;
  }
  return v.replace(/^["']|["']$/g, '');
}

/** Parse one grader (or case.yaml) file's frontmatter into a flat field map. */
export function parseFields(text) {
  const { frontmatter, body } = splitFrontmatter(text);
  const fields = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (m) fields[m[1]] = parseValue(m[2]);
  }
  return { fields, body };
}

/** A `pattern:` value's literal, alphanumeric-only tokens — i.e. the pattern with regex
 * metacharacters and escape classes (\s, \S, alternation, anchors, quantifiers, groups, this
 * repo's doubled-backslash YAML escaping) stripped away, leaving only what it actually names. */
export function literalTokens(pattern) {
  return [...pattern.matchAll(/[A-Za-z0-9]{3,}/g)].map(m => m[0]);
}

const gradersOf = dir => {
  const g = join(dir, 'graders');
  if (!existsSync(g)) return [];
  return readdirSync(g).filter(f => f.endsWith('.md')).map(f => ({ file: f, ...parseFields(readFileSync(join(g, f), 'utf8')) }));
};

const cases = listCases();

test('eval-cases.test.mjs finds at least one case to check', () => {
  assert.ok(cases.length > 0, 'no eval cases found under evals/ — the scan itself is broken');
});

for (const { skill, name, dir } of cases) {
  const label = `${skill}/${name}`;

  test(`${label}: no regex grader's pattern echoes prompt.md`, () => {
    const promptPath = join(dir, 'prompt.md');
    if (!existsSync(promptPath)) return;
    const promptBody = splitFrontmatter(readFileSync(promptPath, 'utf8')).body.toLowerCase();
    for (const { file, fields } of gradersOf(dir)) {
      if (fields.type !== 'regex' || !fields.pattern) continue;
      for (const token of literalTokens(fields.pattern)) {
        assert.ok(!promptBody.includes(token.toLowerCase()), `${label}/graders/${file}: pattern "${fields.pattern}" contains "${token}", which already appears in prompt.md — the without-skill arm can pass by echoing the prompt`);
      }
    }
  });

  test(`${label}: no regex grader targets last_message with no file focus`, () => {
    for (const { file, fields } of gradersOf(dir)) {
      if (fields.type !== 'regex') continue;
      const t = fields.target;
      const fileFocused = t && typeof t === 'object' && t.source === 'file' && t.path;
      assert.ok(fileFocused, `${label}/graders/${file}: regex grader has no file target (target: ${JSON.stringify(t ?? 'last_message (default)')}) — it grades the chat transcript, not a produced file`);
    }
  });

  test(`${label}: has at least one scored outcome grader`, () => {
    const graders = gradersOf(dir);
    assert.ok(graders.length > 0, `${label}: no graders/ directory or no grader files`);
    assert.ok(graders.some(g => g.fields.type && g.fields.type !== 'tool_used'), `${label}: every grader is tool_used — the delta is structurally 0 without a scored outcome grader`);
  });

  test(`${label}: fixture.sh does not reach the network`, () => {
    const fixturePath = join(dir, 'fixture.sh');
    if (!existsSync(fixturePath)) return;
    readFileSync(fixturePath, 'utf8').split(/\r?\n/).forEach((line, i) => {
      assert.ok(!NETWORK_RE.test(line), `${label}/fixture.sh:${i + 1}: references the network ("${line.trim()}") — evals must run offline in the sandbox`);
    });
  });
}
