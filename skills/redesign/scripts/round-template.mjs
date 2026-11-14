// The build script `round new` scaffolds into reviews/<round>/build.mjs. It is the round's own file:
// the person (or agent) edits it to write the page, and `round build` runs it.

/** The source of a round's build.mjs. `title` and `stage` are quoted with JSON, so any text is safe. */
export const buildTemplate = ({ round, title, stage }) => `// Builds this round's page. Run it with: node <skill>/scripts/round.mjs build ${round}
// The kit (render.mjs, blocks.mjs) is found through REDESIGN_KIT, else the path in reviews/.kit.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const kit = process.env.REDESIGN_KIT ?? readFileSync(join(here, '..', '.kit'), 'utf8').trim();
const load = (name) => import(pathToFileURL(join(kit, name)).href);
const { page, ask, figure, counts } = await load('render.mjs');
const { md } = await load('blocks.mjs');

const ROUND = ${JSON.stringify(round)};

const body = [
  md('Replace this paragraph with what the person needs to know before answering.'),
  figure({
    html: '<p>Replace this with the drawing.</p>',
    css: 'p { margin: 0; padding: 1rem; }',
    caption: 'A placeholder drawing',
    alt: 'A placeholder for the drawing',
  }),
  ask({
    id: 'q.first',
    kind: 'choice',
    q: 'Replace this with the one question the page must settle.',
    why: 'Say why it matters in a sentence.',
    options: [
      { value: 'yes', label: 'Yes', detail: 'What this means.', rec: true },
      { value: 'no', label: 'No', detail: 'What this means.' },
    ],
  }),
].join('\\n');

const html = page({
  round: ROUND,
  stage: ${JSON.stringify(stage)},
  title: ${JSON.stringify(title)},
  lede: 'One sentence on what this page is for.',
  tabs: [{ id: 'main', title: 'Main', html: body }],
  extraBox: true,
});

writeFileSync(join(here, 'index.html'), html);
const c = counts(html);
const n = (count, word) => \`\${count} \${word}\${count === 1 ? '' : 's'}\`;
console.log(\`\${ROUND}: \${n(c.asks, 'ask')}, \${n(c.items, 'item')}, \${n(c.figures, 'figure')}\`);
`;
