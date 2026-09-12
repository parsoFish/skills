import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bumpVersion, isoDate, repoSlug,
  updatePluginManifest, updatePackageManifest, updateMarketplaceManifest,
  rollChangelog, changelogSection, bumpAll,
} from '../scripts/release.mjs';

test('bumpVersion bumps the right segment and resets the ones below it', () => {
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
});

test('bumpVersion rejects a bad version or an unknown level', () => {
  assert.throws(() => bumpVersion('v1.2.3', 'patch'), /not a semver version/);
  assert.throws(() => bumpVersion('1.2.3', 'medium'), /unknown bump level/);
});

test('isoDate formats a Date as YYYY-MM-DD', () => {
  assert.equal(isoDate(new Date('2026-09-13T02:10:00.000Z')), '2026-09-13');
});

test('repoSlug parses https and ssh GitHub remotes, with or without .git', () => {
  assert.equal(repoSlug('https://github.com/parsoFish/skills'), 'parsoFish/skills');
  assert.equal(repoSlug('https://github.com/parsoFish/skills.git'), 'parsoFish/skills');
  assert.equal(repoSlug('git@github.com:parsoFish/skills.git'), 'parsoFish/skills');
  assert.throws(() => repoSlug('not a url'), /cannot derive owner\/repo/);
});

test('updatePluginManifest only changes version, returns a new object', () => {
  const before = { name: 'x', version: '0.1.0', license: 'MIT' };
  const after = updatePluginManifest(before, '0.2.0');
  assert.deepEqual(after, { name: 'x', version: '0.2.0', license: 'MIT' });
  assert.equal(before.version, '0.1.0', 'input is not mutated');
});

test('updatePackageManifest only changes version and preserves every other key', () => {
  const before = { name: '@x/y', version: '0.1.0', private: true, scripts: { test: 'node --test' } };
  const after = updatePackageManifest(before, '0.2.0');
  assert.deepEqual(after, { name: '@x/y', version: '0.2.0', private: true, scripts: { test: 'node --test' } });
});

test('updateMarketplaceManifest rewrites version and source to the {source,repo,ref} shape', () => {
  const before = { name: 'mp', plugins: [{ name: 'parso-skills', description: 'd', source: './', version: '0.1.0' }] };
  const after = updateMarketplaceManifest(before, '0.2.0', { pluginName: 'parso-skills', repo: 'parsoFish/skills' });
  assert.deepEqual(after.plugins[0], {
    name: 'parso-skills', description: 'd', version: '0.2.0',
    source: { source: 'github', repo: 'parsoFish/skills', ref: 'v0.2.0' },
  });
});

test('updateMarketplaceManifest throws when no entry matches the plugin name', () => {
  const before = { plugins: [{ name: 'other', version: '0.1.0' }] };
  assert.throws(() => updateMarketplaceManifest(before, '0.2.0', { pluginName: 'parso-skills', repo: 'a/b' }), /no marketplace entry named/);
});

const CHANGELOG = [
  '# Changelog',
  '',
  'All notable changes to this repo. Conventional commits drive entries; one line per skill change.',
  '',
  '## Unreleased',
  '- feat: a',
  '- fix: b',
  '',
  '## 0.1.0 — 2026-09-12',
  '- feat(architecture): scaffold',
  '',
].join('\n');

test('rollChangelog moves Unreleased to a dated heading and leaves a fresh empty Unreleased', () => {
  const out = rollChangelog(CHANGELOG, '0.2.0', '2026-09-13');
  assert.match(out, /## Unreleased\n\n## 0\.2\.0 — 2026-09-13\n- feat: a\n- fix: b\n/);
  assert.match(out, /## 0\.1\.0 — 2026-09-12\n- feat\(architecture\): scaffold/);
  // the fresh Unreleased has nothing but the heading before the next heading
  const freshIdx = out.indexOf('## Unreleased');
  const nextHeadingIdx = out.indexOf('##', freshIdx + '## Unreleased'.length);
  assert.equal(out.slice(freshIdx + '## Unreleased'.length, nextHeadingIdx).trim(), '');
});

test('rollChangelog throws when there is no Unreleased section', () => {
  assert.throws(() => rollChangelog('# Changelog\n\n## 0.1.0 — d\n- x\n', '0.2.0', '2026-09-13'), /no "## Unreleased" section/);
});

test('rollChangelog throws when Unreleased is empty — nothing to release', () => {
  const empty = '# Changelog\n\n## Unreleased\n\n## 0.1.0 — 2026-09-12\n- x\n';
  assert.throws(() => rollChangelog(empty, '0.2.0', '2026-09-13'), /nothing to release/);
});

test('changelogSection returns one version\'s heading and body, not neighbouring sections', () => {
  const section = changelogSection(CHANGELOG, '0.1.0');
  assert.match(section, /^## 0\.1\.0 — 2026-09-12\n- feat\(architecture\): scaffold\n$/);
  assert.doesNotMatch(section, /Unreleased/);
});

test('changelogSection throws for a version with no section', () => {
  assert.throws(() => changelogSection(CHANGELOG, '9.9.9'), /no CHANGELOG section for version 9\.9\.9/);
});

test('bumpAll wires the transforms together against temp copies of the real manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-'));
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'parso-skills', version: '0.1.0', description: 'd', author: { name: 'a' }, license: 'MIT',
    repository: 'https://github.com/parsoFish/skills',
  }, null, 2));
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: 'parso-skills', description: 'd', owner: { name: 'a' },
    plugins: [{ name: 'parso-skills', description: 'All skills in this repo', source: './', version: '0.1.0' }],
  }, null, 2));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@x/y', version: '0.1.0', private: true }, null, 2));
  writeFileSync(join(root, 'CHANGELOG.md'), CHANGELOG);

  const { version, date, repo } = bumpAll(root, 'minor', { now: new Date('2026-09-13T00:00:00.000Z') });
  assert.equal(version, '0.2.0');
  assert.equal(date, '2026-09-13');
  assert.equal(repo, 'parsoFish/skills');

  const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');

  assert.equal(plugin.version, '0.2.0');
  assert.equal(marketplace.plugins[0].version, '0.2.0');
  assert.deepEqual(marketplace.plugins[0].source, { source: 'github', repo: 'parsoFish/skills', ref: 'v0.2.0' });
  assert.equal(pkg.version, '0.2.0');
  assert.equal(pkg.private, true, 'unrelated package.json keys survive the bump untouched');
  assert.match(changelog, /## 0\.2\.0 — 2026-09-13\n- feat: a\n- fix: b/);
});

test('bumpAll throws instead of writing anything when the Unreleased section is empty', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-'));
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'p', version: '0.1.0', repository: 'https://github.com/o/r',
  }));
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'p', version: '0.1.0' }] }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'p', version: '0.1.0' }));
  writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n## 0.1.0 — d\n- x\n');
  assert.throws(() => bumpAll(root, 'patch'), /nothing to release/);
});
