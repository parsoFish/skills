import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractUi } from './extract-ui.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'ui-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  return root;
}

test('Next app router: dynamic segments become :param, route groups are dropped', () => {
  const root = project({
    'app/page.tsx': 'export default function Home() { return null }\n',
    'app/(marketing)/blog/[slug]/page.tsx': 'export default function Post() { return null }\n',
  });
  const r = extractUi(root);
  assert.deepEqual(r.routes.map(x => x.route), ['/', '/blog/:slug']);
});

test('Next pages router: index drops its segment, _app is excluded, api dir is excluded', () => {
  const root = project({
    'pages/blog/[slug].tsx': 'export default function Post() { return null }\n',
    'pages/about/index.tsx': 'export default function About() { return null }\n',
    'pages/_app.tsx': '',
    'pages/api/hello.ts': '',
  });
  const r = extractUi(root);
  assert.deepEqual(r.routes.map(x => x.route).sort(), ['/about', '/blog/:slug']);
});

test('React Router path= and Express app.get literals are captured with their file', () => {
  const root = project({
    'src/App.tsx': '<Route path="/settings" element={<Settings/>} />\n',
    'src/server.ts': "app.get('/health', (req,res) => res.send(\"ok\"))\n",
  });
  const r = extractUi(root);
  assert.deepEqual(r.routes, [{ route: '/health', file: 'src/server.ts' }, { route: '/settings', file: 'src/App.tsx' }]);
});

test('distinct data-* attributes counted and capped to 50 names', () => {
  const root = project({ 'src/App.tsx': '<div data-testid="x" data-state="open" data-testid="y" />\n' });
  const r = extractUi(root);
  assert.equal(r.dataAttributes.count, 2);
  assert.deepEqual(r.dataAttributes.names, ['data-state', 'data-testid']);
});

test('empty project yields empty routes and attributes without throwing', () => {
  const root = project({ 'README.md': 'hi\n' });
  const r = extractUi(root);
  assert.deepEqual(r, { routes: [], dataAttributes: { count: 0, names: [] } });
});

test('opts.ignore excludes a directory from the route/attribute scan', () => {
  const root = project({ 'vendor/src/App.tsx': '<Route path="/settings" element={<Settings/>} />\n' });
  const r = extractUi(root, { ignore: ['vendor'] });
  assert.deepEqual(r, { routes: [], dataAttributes: { count: 0, names: [] } });
});
