// Classify a project's archetypes from manifests across ecosystems. Deterministic, read-only.
// The injectable `fs` covers shallow (root-level) manifest checks so unit tests can fake a tree
// without touching disk; multi-file content scans (every *.go, every *.csproj/*.sln, any
// Dockerfile/compose/Helm chart anywhere in the tree) walk the real `root` directly with
// walkFiles, since a fake, non-existent root safely yields zero matches there.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles } from './walk.mjs';

export const KINDS = ['cli', 'service', 'iac', 'plugin', 'simulation', 'hardware', 'pipeline', 'extension', 'library'];

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
