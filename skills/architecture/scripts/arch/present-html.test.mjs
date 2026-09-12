import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleHtml, injectClassDefs } from './present-html.mjs';

function fixturePng() {
  const dir = mkdtempSync(join(tmpdir(), 'present-html-'));
  const p = join(dir, 'index.png');
  writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef]));
  return p;
}

function baseInput(overrides = {}) {
  return {
    views: [{ id: 'index', title: 'Context', description: 'who and what surrounds the system', pngPath: fixturePng() }],
    written: [{ path: 'docs/architecture/overview.md', markdown: '# Overview\n\nSome facts.\n' }],
    generated: [{ path: 'docs/reference/deps.md', markdown: '# Dependencies\n\n| a | b |\n|---|---|\n' }],
    run: [{ path: 'docs/architecture/_run/review.md', markdown: '# Review\n\nAll clear.\n' }],
    legend: [{ kind: 'service', colour: '#2F5FA8', notation: 'Service — a running process or daemon' }],
    meta: { project: 'Acme', sha: 'abc123', generatedBy: 'arch present-html' },
    ...overrides,
  };
}

test('bundleHtml builds a full document without throwing', () => {
  const html = bundleHtml(baseInput());
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<\/html>\s*$/);
});

test('bundleHtml handles empty input without throwing', () => {
  const html = bundleHtml();
  assert.match(html, /<title>/);
});

test('bundleHtml embeds each PNG as a base64 data URI', () => {
  const html = bundleHtml(baseInput());
  assert.match(html, /src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
});

test('bundleHtml contains a nav entry for every views/written/generated/run item', () => {
  const html = bundleHtml(baseInput());
  assert.match(html, /<nav class="tree"[^>]*>[\s\S]*Context[\s\S]*<\/nav>/);
  assert.match(html, /<nav class="tree"[^>]*>[\s\S]*overview\.md[\s\S]*<\/nav>/);
  assert.match(html, /<nav class="tree"[^>]*>[\s\S]*deps\.md[\s\S]*<\/nav>/);
  assert.match(html, /<nav class="tree"[^>]*>[\s\S]*review\.md[\s\S]*<\/nav>/);
});

test('bundleHtml tags nav and doc entries generated/written, and gap when the markdown carries a GAP: marker', () => {
  const html = bundleHtml(baseInput({
    written: [{ path: 'docs/architecture/risks.md', markdown: '# Risks\n\nGAP: unknown owner.\n' }],
  }));
  assert.match(html, /<span class="tag gap">gap<\/span>/);
  assert.match(html, /<span class="tag generated">generated<\/span>/);
});

test('bundleHtml never lists a .c4 or .json path, even if the caller passes one', () => {
  const html = bundleHtml(baseInput({
    written: [
      { path: 'docs/architecture/model/hand.c4', markdown: 'model {}' },
      { path: 'docs/architecture/overview.md', markdown: '# Overview\n' },
    ],
    generated: [
      { path: 'docs/reference/components.json', markdown: '{}' },
      { path: 'docs/reference/deps.md', markdown: '# Deps\n' },
    ],
  }));
  assert.ok(!html.includes('.c4'));
  assert.ok(!html.includes('components.json'));
  assert.match(html, /overview\.md/);
  assert.match(html, /deps\.md/);
});

test('injectClassDefs prepends the classDef preamble inside a mermaid fence', () => {
  const md = 'before\n\n```mermaid\ngraph TD; a-->b;\n```\n\nafter';
  const out = injectClassDefs(md, 'classDef human fill:#eee,stroke:#333,color:#111');
  assert.match(out, /```mermaid\nclassDef human fill:#eee,stroke:#333,color:#111\ngraph TD; a-->b;\n```/);
});

test('bundleHtml injects the house classDef preamble into an embedded mermaid fence', () => {
  const html = bundleHtml(baseInput({
    written: [{ path: 'docs/architecture/loop.md', markdown: '# Loop\n\n```mermaid\ngraph TD; a-->b;\n```\n' }],
  }));
  assert.match(html, /```mermaid\nclassDef human fill:/);
  assert.match(html, /classDef webui fill:/);
  assert.match(html, /classDef modelapi fill:/);
});

test('bundleHtml keeps the classDef preamble out of docs that have no mermaid fence', () => {
  const html = bundleHtml(baseInput());
  const overviewScript = html.match(/<script type="text\/markdown">([\s\S]*?)<\/script>/)[1];
  assert.ok(!overviewScript.includes('classDef'));
});

test('bundleHtml escapes a literal </script> inside embedded markdown so it cannot close its tag early', () => {
  const html = bundleHtml(baseInput({
    written: [{ path: 'docs/architecture/overview.md', markdown: 'See </script> for details.' }],
  }));
  assert.ok(!html.includes('</script> for details'));
  assert.match(html, /<\\\/script> for details/);
});

test('bundleHtml defines a --k-<kind> and paired --k-<kind>-bg CSS token for all ten mermaid kinds', () => {
  const html = bundleHtml(baseInput());
  for (const kind of ['human', 'webui', 'service', 'cli', 'agent', 'knowledge', 'log', 'workspace', 'external', 'modelapi']) {
    assert.match(html, new RegExp(`--k-${kind}:\\s*#`));
    assert.match(html, new RegExp(`--k-${kind}-bg:\\s*#`));
  }
});

test('bundleHtml carries light-default and dark-override theme blocks', () => {
  const html = bundleHtml(baseInput());
  assert.match(html, /:root\s*\{/);
  assert.match(html, /prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
  assert.match(html, /:root\[data-theme="dark"\]\s*\{/);
});

test('bundleHtml loads marked and mermaid from the pinned cdnjs URLs and no other external script host', () => {
  const html = bundleHtml(baseInput());
  assert.match(html, /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/marked\/12\.0\.2\/marked\.min\.js"><\/script>/);
  assert.match(html, /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/mermaid\/11\.4\.0\/mermaid\.min\.js"><\/script>/);
  const externalScripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.equal(externalScripts.length, 2);
});

test('bundleHtml renders the legend strip from the legend prop', () => {
  const html = bundleHtml(baseInput());
  assert.match(html, /class="swatch"/);
  assert.match(html, /Service — a running process or daemon/);
});

test('bundleHtml header carries project, sha, and generatedBy', () => {
  const html = bundleHtml(baseInput());
  assert.match(html, /<h1>Acme<\/h1>/);
  assert.match(html, /rev abc123 · generated by arch present-html/);
});
