// Test support: a stand-in kit folder (a minimal render.mjs and blocks.mjs) so the round tools
// are tested without the real renderer. Not part of the shipped command line.
import fs from 'node:fs';
import path from 'node:path';

const RENDER = `
export const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
export const page = ({ round, stage, title, lede = '', tabs = [] }) =>
  '<!doctype html><title>' + esc(title) + '</title><p class="stage">' + esc(stage) + '</p><p>' + esc(lede) + '</p>' +
  tabs.map((t) => '<section class="rv-tab" id="tab-' + t.id + '">' + t.html + '</section>').join('');
export const ask = ({ id, q }) => '<article class="rv-ask" data-id="' + id + '">' + esc(q) + '</article>';
export const figure = ({ html }) => '<figure class="rv-figure">' + html + '</figure>';
export const counts = (html) => ({
  asks: (html.match(/class="rv-ask"/g) ?? []).length,
  items: (html.match(/class="rv-item"/g) ?? []).length,
  figures: (html.match(/class="rv-figure"/g) ?? []).length,
});
`;
const BLOCKS = 'export const md = (m) => "<p>" + String(m) + "</p>";\n';

/** Writes a fake kit under `root` and returns its path. */
export const fakeKit = (root) => {
  const kit = path.join(root, 'fake-kit');
  fs.mkdirSync(kit, { recursive: true });
  fs.writeFileSync(path.join(kit, 'render.mjs'), RENDER);
  fs.writeFileSync(path.join(kit, 'blocks.mjs'), BLOCKS);
  return kit;
};

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

test('the fake kit exports what the scaffolded build script imports', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redesign-fixture-'));
  try {
    const kit = fakeKit(root);
    const render = await import(pathToFileURL(path.join(kit, 'render.mjs')).href);
    const blocks = await import(pathToFileURL(path.join(kit, 'blocks.mjs')).href);
    assert.deepEqual(render.counts(render.ask({ id: 'a', q: 'Q' })), { asks: 1, items: 0, figures: 0 });
    assert.equal(blocks.md('x'), '<p>x</p>');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
