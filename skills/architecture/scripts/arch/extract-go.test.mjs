import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractGo, specifiers } from './extract-go.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'go-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

test('specifiers reads both a grouped import block and single-line imports', () => {
  const text = 'package main\n\nimport (\n\t"fmt"\n\t"net/http"\n\n\tmyalias "example.com/mod/pkg"\n)\n\nimport "os"\n';
  assert.deepEqual(specifiers(text), ['fmt', 'net/http', 'example.com/mod/pkg', 'os']);
});

test('an internal package import resolves to a representative file in that package dir', () => {
  const root = project({
    'go.mod': 'module example.com/mod\n\ngo 1.21\n',
    'cmd/main.go': 'package main\n\nimport (\n\t"example.com/mod/pkg/util"\n)\n\nfunc main() {}\n',
    'pkg/util/a.go': 'package util\n',
    'pkg/util/b.go': 'package util\n',
  });
  const r = extractGo(root);
  const main = r.modules.find(m => m.source === 'cmd/main.go');
  assert.deepEqual(main.dependencies, [{ module: 'example.com/mod/pkg/util', resolved: 'pkg/util/a.go' }]);
});

test('an import of a package dir with no .go files is reported unresolved', () => {
  const root = project({
    'go.mod': 'module example.com/mod\n\ngo 1.21\n',
    'main.go': 'package main\n\nimport "example.com/mod/pkg/missing"\n\nfunc main() {}\n',
  });
  const r = extractGo(root);
  assert.deepEqual(r.modules[0].dependencies, [{ module: 'example.com/mod/pkg/missing', resolved: null, couldNotResolve: true }]);
});

test('stdlib and third-party imports are unresolved', () => {
  const root = project({
    'go.mod': 'module example.com/mod\n\ngo 1.21\n',
    'main.go': 'package main\n\nimport (\n\t"fmt"\n\t"github.com/spf13/cobra"\n)\n\nfunc main() {}\n',
  });
  const r = extractGo(root);
  assert.deepEqual(r.modules[0].dependencies, [
    { module: 'fmt', resolved: null, couldNotResolve: true },
    { module: 'github.com/spf13/cobra', resolved: null, couldNotResolve: true },
  ]);
});

test('_test.go files are excluded from the representative-file pool but still scanned as sources', () => {
  const root = project({
    'go.mod': 'module example.com/mod\n\ngo 1.21\n',
    'pkg/util/only_test.go': 'package util\n',
    'main.go': 'package main\n\nimport "example.com/mod/pkg/util"\n\nfunc main() {}\n',
  });
  const r = extractGo(root);
  // no non-test .go file exists in pkg/util, so the import cannot resolve
  assert.deepEqual(r.modules.find(m => m.source === 'main.go').dependencies, [
    { module: 'example.com/mod/pkg/util', resolved: null, couldNotResolve: true },
  ]);
  // the _test.go file itself is still a scanned source module
  assert.ok(r.modules.some(m => m.source === 'pkg/util/only_test.go'));
});

test('an import of the module root itself resolves against the repo root package', () => {
  const root = project({
    'go.mod': 'module example.com/mod\n\ngo 1.21\n',
    'root.go': 'package mod\n',
    'cmd/main.go': 'package main\n\nimport "example.com/mod"\n\nfunc main() {}\n',
  });
  const r = extractGo(root);
  assert.deepEqual(r.modules.find(m => m.source === 'cmd/main.go').dependencies, [
    { module: 'example.com/mod', resolved: 'root.go' },
  ]);
});

test('missing go.mod leaves every import unresolved rather than throwing', () => {
  const root = project({ 'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {}\n' });
  const r = extractGo(root);
  assert.deepEqual(r.modules, [{ source: 'main.go', dependencies: [{ module: 'fmt', resolved: null, couldNotResolve: true }] }]);
});

test('output is deterministic: modules and dependencies are sorted', () => {
  const root = project({
    'go.mod': 'module example.com/mod\n\ngo 1.21\n',
    'z.go': 'package mod\n\nimport (\n\t"os"\n\t"fmt"\n)\n',
    'a.go': 'package mod\n',
  });
  const r1 = extractGo(root);
  const r2 = extractGo(root);
  assert.deepEqual(r1, r2);
  assert.deepEqual(r1.modules.map(m => m.source), ['a.go', 'z.go']);
  assert.deepEqual(r1.modules.find(m => m.source === 'z.go').dependencies.map(d => d.module), ['fmt', 'os']);
});

test('opts.ignore excludes a directory from the scan', () => {
  const root = project({
    'go.mod': 'module example.com/mod\n\ngo 1.21\n',
    'vendor-extra/skip.go': 'package skip\n',
    'main.go': 'package main\n',
  });
  const r = extractGo(root, { ignore: ['vendor-extra'] });
  assert.deepEqual(r.modules.map(m => m.source), ['main.go']);
});

test('no .go files gives an empty module list', () => {
  const root = project({ 'go.mod': 'module example.com/mod\n\ngo 1.21\n', 'README.md': 'hi\n' });
  const r = extractGo(root);
  assert.deepEqual(r, { modules: [], summary: { totalCruised: 0, engine: 'builtin-go' } });
});
