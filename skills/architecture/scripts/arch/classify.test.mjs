import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, foldRulesCheatSheet } from './classify.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function fakeFs(files) { return { exists: p => p in files, read: p => files[p], list: p => Object.keys(files).filter(f => f.startsWith(p === '.' ? '' : p + '/')).map(f => f.slice(p === '.' ? 0 : p.length + 1).split('/')[0]) }; }

// Real temp dirs for checks that scan every file of a kind anywhere in the tree (Go, .NET,
// Docker) — those walk `root` on the real filesystem regardless of the injected `fs`.
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'classify-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

test('terraform repo is iac', () => {
  const r = classify('/x', fakeFs({ 'main.tf': '', 'README.md': '' }));
  assert.deepEqual(r.kinds, ['iac']);
});
test('node cli with bin is cli', () => {
  const r = classify('/x', fakeFs({ 'package.json': JSON.stringify({ bin: { mytool: 'x.js' } }) }));
  assert.deepEqual(r.kinds, ['cli']); assert.equal(r.ambiguous, false);
});
test('next + ws monorepo is service, flagged ambiguous when also plugin host', () => {
  const r = classify('/x', fakeFs({ 'package.json': JSON.stringify({ workspaces: ['a'], dependencies: { next: '1', ws: '1' } }), 'skills/x/SKILL.md': '' }));
  assert.deepEqual(r.kinds, ['plugin', 'service']); assert.equal(r.ambiguous, true);
});
test('browser extension manifest', () => {
  const r = classify('/x', fakeFs({ 'manifest.json': JSON.stringify({ manifest_version: 3 }) }));
  assert.deepEqual(r.kinds, ['extension']);
});
test('python with gpio libs is hardware', () => {
  const r = classify('/x', fakeFs({ 'requirements.txt': 'rpi_ws281x\n' }));
  assert.deepEqual(r.kinds, ['hardware']);
});

test('Cargo.toml [[bin]] is cli', () => {
  const r = classify('/x', fakeFs({ 'Cargo.toml': '[package]\nname = "x"\n\n[[bin]]\nname = "x"\n' }));
  assert.deepEqual(r.kinds, ['cli']);
});
test('Cargo.toml [lib] is library', () => {
  const r = classify('/x', fakeFs({ 'Cargo.toml': '[package]\nname = "x"\n\n[lib]\nname = "x"\n' }));
  assert.deepEqual(r.kinds, ['library']);
});
test('Cargo.toml with neither [[bin]] nor [lib] falls back to the universal library default', () => {
  const r = classify('/x', fakeFs({ 'Cargo.toml': '[package]\nname = "x"\n' }));
  assert.deepEqual(r.kinds, ['library']);
  assert.ok(r.evidence.includes('no manifest signal'));
});

test('go.mod importing terraform-plugin is a plugin', () => {
  const r = classify('/x', fakeFs({ 'go.mod': 'module x\n\nrequire github.com/hashicorp/terraform-plugin-sdk v2.0.0\n' }));
  assert.deepEqual(r.kinds, ['plugin']);
});
test('go.mod + net/http import anywhere in *.go is service', () => {
  const root = project({
    'go.mod': 'module example.com/mod\n\ngo 1.21\n',
    'cmd/server/main.go': 'package main\n\nimport (\n\t"net/http"\n)\n\nfunc main() { http.ListenAndServe(":8080", nil) }\n',
  });
  assert.deepEqual(classify(root).kinds, ['service']);
});
test('go.mod + package main with cobra/flag anywhere in *.go is cli', () => {
  const root = project({
    'go.mod': 'module example.com/mod\n\ngo 1.21\n',
    'main.go': 'package main\n\nimport (\n\t"flag"\n)\n\nfunc main() { flag.Parse() }\n',
  });
  assert.deepEqual(classify(root).kinds, ['cli']);
});
test('go service and cli signals both present is flagged ambiguous', () => {
  const root = project({
    'go.mod': 'module example.com/mod\n\ngo 1.21\n',
    'cmd/server/main.go': 'package main\n\nimport (\n\t"net/http"\n\t"github.com/spf13/cobra"\n)\n\nfunc main() {}\n',
  });
  const r = classify(root);
  assert.deepEqual(r.kinds, ['cli', 'service']);
  assert.equal(r.ambiguous, true);
});

test('pom.xml with spring-boot is service', () => {
  const r = classify('/x', fakeFs({ 'pom.xml': '<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>' }));
  assert.deepEqual(r.kinds, ['service']);
});
test('build.gradle.kts without a service framework is library', () => {
  const r = classify('/x', fakeFs({ 'build.gradle.kts': 'plugins {\n    kotlin("jvm")\n}\n' }));
  assert.deepEqual(r.kinds, ['library']);
});

test('.csproj referencing Microsoft.AspNetCore anywhere is service', () => {
  const root = project({ 'src/Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.AspNetCore.App" /></ItemGroup></Project>' });
  assert.deepEqual(classify(root).kinds, ['service']);
});
test('.csproj without AspNetCore is library', () => {
  const root = project({ 'src/Lib/Lib.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>' });
  assert.deepEqual(classify(root).kinds, ['library']);
});

test('a Dockerfile anywhere in the tree adds service + containerised evidence', () => {
  const root = project({ 'Dockerfile': 'FROM node:22\n' });
  const r = classify(root);
  assert.deepEqual(r.kinds, ['service']);
  assert.ok(r.evidence.includes('containerised'));
});

test('pnpm-workspace.yaml adds monorepo evidence', () => {
  const r = classify('/x', fakeFs({ 'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n' }));
  assert.ok(r.evidence.includes('monorepo'));
  assert.deepEqual(r.kinds, ['library']); // no other signal beyond the monorepo marker
});

test('pyproject with fastapi is service', () => {
  const r = classify('/x', fakeFs({ 'pyproject.toml': '[project]\ndependencies = ["fastapi"]\n' }));
  assert.deepEqual(r.kinds, ['service']);
});
test('pyproject with typer is cli', () => {
  const r = classify('/x', fakeFs({ 'pyproject.toml': '[project]\ndependencies = ["typer"]\n' }));
  assert.deepEqual(r.kinds, ['cli']);
});

test('an empty repo never returns an empty kinds list — falls back to library', () => {
  const root = project({});
  assert.deepEqual(classify(root), { kinds: ['library'], evidence: ['no manifest signal'], ambiguous: false });
});

test('foldRulesCheatSheet lists every key of both shipped fold-rules files, generated so it cannot drift', () => {
  const defaults = JSON.parse(readFileSync(join(here, 'fold-rules.default.json'), 'utf8'));
  const template = JSON.parse(readFileSync(join(here, '..', '..', 'assets', 'fold-rules.json'), 'utf8'));
  const sheet = foldRulesCheatSheet();
  for (const key of new Set([...Object.keys(defaults), ...Object.keys(template)])) {
    assert.match(sheet, new RegExp('`' + key + '`'), `missing field ${key}`);
  }
  // a key present only in the template (not the runtime default) still gets its template value.
  assert.match(sheet, /`registries`[\s\S]*default: \[\]/);
});

test('foldRulesCheatSheet also documents the fields neither shipped file shows (they default to {}/[])', () => {
  const sheet = foldRulesCheatSheet();
  for (const key of ['system', 'kinds', 'titles', 'descriptions', 'areas', 'retired']) {
    assert.match(sheet, new RegExp('`' + key + '`'), `missing unshown field ${key}`);
  }
});

test('foldRulesCheatSheet is pure and deterministic', () => {
  assert.equal(foldRulesCheatSheet(), foldRulesCheatSheet());
});
