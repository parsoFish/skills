// Classify a project's archetypes from manifests. Deterministic, read-only.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const KINDS = ['cli', 'service', 'iac', 'plugin', 'simulation', 'hardware', 'pipeline', 'extension'];

export function classify(root, fs = { exists: p => existsSync(join(root, p)), read: p => readFileSync(join(root, p), 'utf8'), list: p => existsSync(join(root, p)) ? readdirSync(join(root, p)) : [] }) {
  const kinds = new Set(); const evidence = [];
  const pkg = fs.exists('package.json') ? JSON.parse(fs.read('package.json')) : null;
  const deps = pkg ? { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } : {};
  if (fs.list('.').some(f => f.endsWith('.tf')) || fs.list('infra').some(f => f.endsWith('.tf'))) { kinds.add('iac'); evidence.push('*.tf present'); }
  if (fs.exists('manifest.json')) { try { const m = JSON.parse(fs.read('manifest.json')); if (m.manifest_version) { kinds.add('extension'); evidence.push('manifest.json with manifest_version'); } } catch {} }
  if (fs.exists('go.mod') && /terraform-plugin/.test(fs.read('go.mod'))) { kinds.add('plugin'); evidence.push('go.mod imports terraform-plugin'); }
  if (fs.exists('.claude-plugin/plugin.json') || fs.list('skills').length) { kinds.add('plugin'); evidence.push('skills/ or plugin manifest'); }
  if (pkg) {
    if (pkg.bin) { kinds.add('cli'); evidence.push('package.json bin'); }
    if (deps.next || deps.express || deps.fastify || deps.koa || deps.hono || deps.ws) { kinds.add('service'); evidence.push('web framework or ws dependency'); }
    if ((deps.vite || deps.phaser || deps.pixi) && !deps.next) { kinds.add('simulation'); evidence.push('vite/phaser without a server'); }
    if (pkg.workspaces && (deps['@anthropic-ai/claude-agent-sdk'] || Object.keys(deps).some(d => d.includes('agent')))) { kinds.add('service'); evidence.push('agent runtime dependency'); }
  }
  if (fs.exists('pyproject.toml') || fs.exists('requirements.txt')) {
    const t = (fs.exists('pyproject.toml') ? fs.read('pyproject.toml') : '') + (fs.exists('requirements.txt') ? fs.read('requirements.txt') : '');
    if (/airflow|dagster|prefect|pandas|pyarrow|duckdb/.test(t)) { kinds.add('pipeline'); evidence.push('data libs in python deps'); }
    if (/RPi|gpio|adafruit|pyserial|rpi_ws281x/i.test(t)) { kinds.add('hardware'); evidence.push('gpio/serial libs'); }
    if (kinds.size === 0) { kinds.add('cli'); evidence.push('python project, no other signal'); }
  }
  if (kinds.size === 0 && pkg) { kinds.add('cli'); evidence.push('package.json without other signals'); }
  return { kinds: [...kinds].sort(), evidence, ambiguous: kinds.size > 1 };
}
