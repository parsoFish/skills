// Classify a project's archetypes from manifests across ecosystems. Deterministic, read-only.
// The injectable `fs` covers shallow (root-level) manifest checks so unit tests can fake a tree
// without touching disk; multi-file content scans (every *.go, every *.csproj/*.sln, any
// Dockerfile/compose/Helm chart anywhere in the tree) walk the real `root` directly with
// walkFiles, since a fake, non-existent root safely yields zero matches there.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkFiles } from './walk.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const KINDS = ['cli', 'service', 'iac', 'plugin', 'simulation', 'hardware', 'pipeline', 'extension', 'library'];

// One line of guidance per field the two shipped fold-rules files carry. Keyed off those files'
// own keys (see foldRulesCheatSheet) so a field renamed there without an update here is still
// listed — just with a generic note instead of a wrong one.
const FIELD_NOTES = {
  include: 'regex string; which top-level dirs the builtin/dependency-cruiser engines scan for source files',
  roots: 'array of dirs (relative to the project root) the engine scans from',
  engine: "'builtin' (offline relative-import scanner, default) | 'go' (offline Go package scanner) | 'dependency-cruiser' (needs npx, resolves tsconfig paths)",
  tsConfig: 'true to pass --ts-config to dependency-cruiser; ignored by builtin/go',
  rules: "array of {match: '<regex>', component: '<name, may use $1 from match groups>'} — first match wins, folds a file path into a named component",
  registries: "array of {name, glob} — extension-point discovery globs read by extract-ext-points.mjs",
  scanIgnore: 'array of glob-ish path prefixes excluded from every extractor (vendored trees, archives, generated dirs)',
  minorEdgeThreshold: 'integer; edges with count below this render as untitled kind minor and are hidden from rendered views',
};

// Real fold-rules.json keys that never appear in either shipped file because they default to
// {}/[] when absent — SKILL.md's stage 0 names these as the ones worth adjusting per project.
const UNSHOWN_FIELDS = {
  system: "{id, title} — overrides the system container's id/title (default: {id: 'system', title: <project dir name>})",
  kinds: '{"<component id>": "<house kind>"} — overrides model.mjs inferKind() per component',
  titles: '{"<component id>": "<display title>"} — overrides the container/component title in generated.c4',
  descriptions: '{"<component id>": "<one line>"} — shown in generated.c4, capped at 90 characters',
  areas: '{"<area name>": ["<component id>", ...]} — seeds one hand.c4 view per area',
  retired: '["term", ...] — words the naming.retired fitness rule and glossary.retired completeness check flag',
};

/**
 * Every field of fold-rules.json with its default and one example, generated from the two shipped
 * files' own keys so this sheet cannot drift from them. Lets stage 0 skip grepping model.mjs /
 * walk.mjs for the schema. `assets/fold-rules.json` is the copy-to-project template; this skill
 * script's own `fold-rules.default.json` is the runtime fallback `loadRules()` reads when a
 * project has not adopted one yet — read both since their key sets differ slightly.
 */
export function foldRulesCheatSheet() {
  const runtimeDefault = JSON.parse(readFileSync(join(here, 'fold-rules.default.json'), 'utf8'));
  const template = JSON.parse(readFileSync(join(here, '..', '..', 'assets', 'fold-rules.json'), 'utf8'));
  const keys = [...new Set([...Object.keys(runtimeDefault), ...Object.keys(template)])];
  const lines = [
    '# fold-rules.json fields', '',
    'Generated from fold-rules.default.json + assets/fold-rules.json — every field below is real; nothing here is invented.', '',
  ];
  for (const key of keys) {
    const value = key in runtimeDefault ? runtimeDefault[key] : template[key];
    lines.push(`- \`${key}\`: ${FIELD_NOTES[key] ?? 'see assets/fold-rules.json'}`, `  default: ${JSON.stringify(value)}`);
  }
  lines.push('', 'Optional fields not present in either shipped file because they default to `{}`/`[]` when absent:');
  for (const [key, note] of Object.entries(UNSHOWN_FIELDS)) lines.push(`- \`${key}\`: ${note}`);
  return `${lines.join('\n')}\n`;
}

function readAll(root, exts) {
  return walkFiles(root, { exts }).map(rel => { try { return readFileSync(join(root, rel), 'utf8'); } catch { return ''; } }).join('\n');
}

function anyFileNamed(root, matcher) {
  try { return walkFiles(root, {}).some(f => matcher(f.split('/').pop())); } catch { return false; }
}

export function classify(root, fs = { exists: p => existsSync(join(root, p)), read: p => readFileSync(join(root, p), 'utf8'), list: p => existsSync(join(root, p)) ? readdirSync(join(root, p)) : [] }) {
  const kinds = new Set(); const evidence = [];
  const pkg = fs.exists('package.json') ? JSON.parse(fs.read('package.json')) : null;
  const deps = pkg ? { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } : {};

  if (fs.list('.').some(f => f.endsWith('.tf')) || fs.list('infra').some(f => f.endsWith('.tf'))) { kinds.add('iac'); evidence.push('*.tf present'); }
  if (fs.exists('manifest.json')) { try { const m = JSON.parse(fs.read('manifest.json')); if (m.manifest_version) { kinds.add('extension'); evidence.push('manifest.json with manifest_version'); } } catch {} }

  // plugin: an explicit plugin manifest, a skills/*/SKILL.md package (kept), or a Go terraform-plugin import.
  if (fs.exists('.claude-plugin/plugin.json')) { kinds.add('plugin'); evidence.push('plugin manifest'); }
  if (fs.list('skills').some(name => fs.exists(`skills/${name}/SKILL.md`))) { kinds.add('plugin'); evidence.push('skills/*/SKILL.md'); }

  if (pkg) {
    if (pkg.bin) { kinds.add('cli'); evidence.push('package.json bin'); }
    if (deps.next || deps.express || deps.fastify || deps.koa || deps.hono || deps.ws) { kinds.add('service'); evidence.push('web framework or ws dependency'); }
    if ((deps.vite || deps.phaser || deps.pixi) && !deps.next) { kinds.add('simulation'); evidence.push('vite/phaser without a server'); }
    if (pkg.workspaces && (deps['@anthropic-ai/claude-agent-sdk'] || Object.keys(deps).some(d => d.includes('agent')))) { kinds.add('service'); evidence.push('agent runtime dependency'); }
  }
  if (fs.exists('pnpm-workspace.yaml') || fs.exists('turbo.json') || fs.exists('nx.json')) evidence.push('monorepo');

  // Cargo: [[bin]] -> cli, [lib] -> library.
  if (fs.exists('Cargo.toml')) {
    const t = fs.read('Cargo.toml');
    if (/\[\[bin\]\]/.test(t)) { kinds.add('cli'); evidence.push('Cargo.toml [[bin]]'); }
    if (/\[lib\]/.test(t)) { kinds.add('library'); evidence.push('Cargo.toml [lib]'); }
  }

  // Go: terraform-plugin -> plugin; net/http or a web framework anywhere in *.go -> service;
  // package main with cobra/flag anywhere in *.go -> cli.
  if (fs.exists('go.mod')) {
    const goMod = fs.read('go.mod');
    if (/terraform-plugin/.test(goMod)) { kinds.add('plugin'); evidence.push('go.mod imports terraform-plugin'); }
    const goText = readAll(root, ['.go']);
    if (/net\/http|gin-gonic\/gin|labstack\/echo|go-chi\/chi|gofiber\/fiber/.test(goText)) { kinds.add('service'); evidence.push('go: net/http or gin/echo/chi/fiber import'); }
    if (/package\s+main/.test(goText) && /spf13\/cobra|"flag"/.test(goText)) { kinds.add('cli'); evidence.push('go: package main with cobra/flag'); }
  }

  // Java/JVM: pom.xml or build.gradle(.kts) -> service if spring/quarkus/micronaut, else library.
  const javaFile = ['pom.xml', 'build.gradle', 'build.gradle.kts'].find(f => fs.exists(f));
  if (javaFile) {
    const t = fs.read(javaFile);
    if (/spring-boot|quarkus|micronaut/i.test(t)) { kinds.add('service'); evidence.push(`${javaFile}: spring/quarkus/micronaut`); }
    else { kinds.add('library'); evidence.push(`${javaFile}: no service framework`); }
  }

  // .NET: *.csproj/*.sln anywhere -> service if Microsoft.AspNetCore, else library.
  const netText = readAll(root, ['.csproj', '.sln']);
  if (netText.trim()) {
    if (/Microsoft\.AspNetCore/.test(netText)) { kinds.add('service'); evidence.push('.csproj/.sln: Microsoft.AspNetCore'); }
    else { kinds.add('library'); evidence.push('.csproj/.sln: no AspNetCore reference'); }
  }

  // Containerised deployables: Dockerfile, docker-compose, or a Helm chart anywhere in the tree.
  if (anyFileNamed(root, n => n === 'Dockerfile' || /^docker-compose\.ya?ml$/.test(n) || n === 'Chart.yaml')) {
    kinds.add('service'); evidence.push('containerised');
  }

  if (fs.exists('pyproject.toml') || fs.exists('requirements.txt')) {
    const t = (fs.exists('pyproject.toml') ? fs.read('pyproject.toml') : '') + (fs.exists('requirements.txt') ? fs.read('requirements.txt') : '');
    if (/fastapi|flask|django/.test(t)) { kinds.add('service'); evidence.push('python web framework (fastapi/flask/django)'); }
    if (/\btyper\b|\bclick\b/.test(t)) { kinds.add('cli'); evidence.push('python cli framework (typer/click)'); }
    if (/airflow|dagster|prefect|pandas|pyarrow|duckdb/.test(t)) { kinds.add('pipeline'); evidence.push('data libs in python deps'); }
    if (/RPi|gpio|adafruit|pyserial|rpi_ws281x/i.test(t)) { kinds.add('hardware'); evidence.push('gpio/serial libs'); }
  }

  if (kinds.size === 0) { kinds.add('library'); evidence.push('no manifest signal'); }
  return { kinds: [...kinds].sort(), evidence, ambiguous: kinds.size > 1 };
}
