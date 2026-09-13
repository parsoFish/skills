#!/usr/bin/env node
// Release: bump the plugin version across every manifest that carries it, roll the CHANGELOG's
// "## Unreleased" section into a dated one, and print a version's CHANGELOG section for release
// notes. Pure functions do the transforms; main() is the only part that touches disk.
// Usage:
//   node scripts/release.mjs bump <patch|minor|major> [--now <ISO date>] [--root <dir>]
//   node scripts/release.mjs changelog-section <version> [--root <dir>]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Pure: "1.2.3" + "minor" -> "1.3.0". Throws on an unparsable version or an unknown level. */
export function bumpVersion(version, level) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
  if (!m) throw new Error(`release: not a semver version: "${version}"`);
  let [major, minor, patch] = m.slice(1).map(Number);
  if (level === 'major') { major += 1; minor = 0; patch = 0; }
  else if (level === 'minor') { minor += 1; patch = 0; }
  else if (level === 'patch') { patch += 1; }
  else throw new Error(`release: unknown bump level "${level}" (use patch, minor or major)`);
  return `${major}.${minor}.${patch}`;
}

/** Pure: a Date as YYYY-MM-DD. */
export function isoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Pure: "owner/repo" parsed out of a plugin.json `repository` URL. */
export function repoSlug(repositoryUrl) {
  const m = /github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(repositoryUrl ?? '');
  if (!m) throw new Error(`release: cannot derive owner/repo from repository "${repositoryUrl}"`);
  return m[1];
}

/** Pure: plugin.json with only `version` replaced. */
export function updatePluginManifest(manifest, version) {
  return { ...manifest, version };
}

/** Pure: package.json with only `version` replaced; every other key is preserved untouched. */
export function updatePackageManifest(manifest, version) {
  return { ...manifest, version };
}

/**
 * Pure: marketplace.json with the named plugin entry's version and source pin rewritten to the
 * shape `claude plugin validate --strict` actually accepts: {source, repo, ref}. A `ref`/`sha`
 * pair on the entry itself is not a valid field there.
 */
export function updateMarketplaceManifest(manifest, version, { pluginName, repo }) {
  let found = false;
  const plugins = (manifest.plugins ?? []).map(p => {
    if (p.name !== pluginName) return p;
    found = true;
    // `url` + https: the `github` source type clones over SSH and fails on a machine without a GitHub key.
    return { ...p, version, source: { source: 'url', url: `https://github.com/${repo}.git`, ref: `v${version}` } };
  });
  if (!found) throw new Error(`release: no marketplace entry named "${pluginName}"`);
  return { ...manifest, plugins };
}

/**
 * Pure: move the "## Unreleased" section to a dated "## X.Y.Z — <date>" heading right below it,
 * leaving a fresh, empty "## Unreleased" in place. Throws if there is no Unreleased section, or
 * it has nothing in it — bumping with nothing to release is a mistake, not a no-op.
 */
export function rollChangelog(changelog, version, date) {
  const heading = /^##[ \t]+Unreleased[ \t]*$/im.exec(changelog);
  if (!heading) throw new Error('release: CHANGELOG.md has no "## Unreleased" section');
  const afterHeading = heading.index + heading[0].length;
  const next = /^##[ \t]+/m.exec(changelog.slice(afterHeading));
  const sectionEnd = next ? afterHeading + next.index : changelog.length;
  const body = changelog.slice(afterHeading, sectionEnd).replace(/^\n+/, '').replace(/\n+$/, '\n');
  if (!body.trim()) throw new Error('release: "## Unreleased" section is empty — nothing to release');
  const before = changelog.slice(0, heading.index);
  const after = changelog.slice(sectionEnd);
  const rebuilt = `${before}## Unreleased\n\n## ${version} — ${date}\n${body}\n${after}`;
  return rebuilt.replace(/\n{3,}/g, '\n\n');
}

/** Pure: the full text of one version's CHANGELOG section (its heading plus body). Throws if absent. */
export function changelogSection(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^##[ \\t]+${escaped}\\b.*$`, 'm').exec(changelog);
  if (!heading) throw new Error(`release: no CHANGELOG section for version ${version}`);
  const afterHeading = heading.index + heading[0].length;
  const next = /^##[ \t]+/m.exec(changelog.slice(afterHeading));
  const end = next ? afterHeading + next.index : changelog.length;
  return changelog.slice(heading.index, end).trim() + '\n';
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2) + '\n'); }

/** Orchestrates the pure transforms above across the four files that carry version/CHANGELOG state. */
export function bumpAll(root, level, { now = new Date() } = {}) {
  const pluginPath = join(root, '.claude-plugin', 'plugin.json');
  const marketplacePath = join(root, '.claude-plugin', 'marketplace.json');
  const packagePath = join(root, 'package.json');
  const changelogPath = join(root, 'CHANGELOG.md');

  const plugin = readJson(pluginPath);
  const version = bumpVersion(plugin.version, level);
  const date = isoDate(now);
  const repo = repoSlug(plugin.repository);

  writeJson(pluginPath, updatePluginManifest(plugin, version));
  writeJson(marketplacePath, updateMarketplaceManifest(readJson(marketplacePath), version, { pluginName: plugin.name, repo }));
  writeJson(packagePath, updatePackageManifest(readJson(packagePath), version));
  writeFileSync(changelogPath, rollChangelog(readFileSync(changelogPath, 'utf8'), version, date));

  return { version, date, repo };
}

function usage() {
  console.error([
    'release: usage:',
    '  node scripts/release.mjs bump <patch|minor|major> [--now <ISO date>]',
    '  node scripts/release.mjs changelog-section <version>',
  ].join('\n'));
}

function main() {
  const args = process.argv.slice(2);
  const flag = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const root = flag('--root', ROOT);
  const [cmd, arg] = args;

  if (cmd === 'bump') {
    if (!['patch', 'minor', 'major'].includes(arg)) { usage(); process.exit(1); }
    const nowFlag = flag('--now', null);
    try {
      const { version, date } = bumpAll(root, arg, { now: nowFlag ? new Date(nowFlag) : new Date() });
      console.log(`release: bumped to ${version} (${date})`);
    } catch (err) { console.error(err.message); process.exit(1); }
    return;
  }
  if (cmd === 'changelog-section') {
    if (!arg) { usage(); process.exit(1); }
    try {
      const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
      process.stdout.write(changelogSection(changelog, arg));
    } catch (err) { console.error(err.message); process.exit(1); }
    return;
  }
  usage();
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
