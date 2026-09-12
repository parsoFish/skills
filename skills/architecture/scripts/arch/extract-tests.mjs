// Extract the test inventory: counts per top-level dir plus @seam/@layer tag adoption.
// Deterministic, read-only, no lib.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkFiles } from './walk.mjs';

// This extractor's own test-file definition (its inventory purpose), distinct from walk.mjs's
// broader isTestPath (used elsewhere to exclude test-adjacent content — stories, fixtures —
// from production-code scans): a story or fixture is not a "test" for this inventory.
const TEST_FILE = /\.(test|spec)\.[^/]+$/;
const TEST_DIR = /(^|\/)(tests?|__tests__)(\/|$)/;
const LAYERS = ['unit', 'contract', 'journey', 'ground'];

// When no @seam/@layer tags exist anywhere, guess a layer per test dir from its path so the
// tests-by-seam grid is never empty (a project with zero tagging still gets a starting point).
// First match wins; a dir matching none of these defaults to 'unit'.
const LAYER_GUESSES = [
  { layer: 'unit', re: /unit|spec/i },
  { layer: 'contract', re: /contract|integration/i },
  { layer: 'journey', re: /e2e|journey|walkthrough|stories/i },
  { layer: 'ground', re: /verify|acceptance/i },
];

function guessLayer(dir) {
  for (const { layer, re } of LAYER_GUESSES) if (re.test(dir)) return layer;
  return 'unit';
}

function isTestFile(rel) { return TEST_FILE.test(rel) || TEST_DIR.test(rel); }

// First two directory segments, e.g. "packages/flows/tests/a.test.ts" -> "packages/flows".
function topDir(rel) {
  const dirSegs = rel.split('/').slice(0, -1);
  return dirSegs.length ? dirSegs.slice(0, 2).join('/') : '.';
}

/** Test inventory: file counts per top-level dir, plus @seam/@layer tag coverage. */
export function extractTests(root, opts = {}) {
  const { ignore = [] } = opts;
  const relFiles = walkFiles(root, { ignore }).filter(isTestFile);
  const total = relFiles.length;

  const dirCount = new Map();
  for (const rel of relFiles) { const d = topDir(rel); dirCount.set(d, (dirCount.get(d) ?? 0) + 1); }
  const byDir = [...dirCount.entries()].map(([dir, count]) => ({ dir, count })).sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));

  const seamMap = new Map();
  for (const rel of relFiles) {
    let text; try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const sm = line.match(/@seam\s+([A-Za-z0-9_.-]+)/);
      if (!sm) continue;
      const seam = sm[1];
      if (!seamMap.has(seam)) seamMap.set(seam, { unit: 0, contract: 0, journey: 0, ground: 0 });
      const lm = line.match(/@layer\s+(unit|contract|journey|ground)/);
      if (lm) seamMap.get(seam)[lm[1]] += 1;
    }
  }
  const seams = [...seamMap.entries()].map(([seam, layers]) => ({ seam, layers })).sort((a, b) => a.seam.localeCompare(b.seam));
  const taggingAdopted = seams.length > 0;

  // No real tags anywhere: emit a heuristic row per test dir, guessed layer marked '~', so the
  // grid still has something to look at instead of rendering as empty.
  const heuristic = !taggingAdopted && byDir.length > 0;
  const renderedSeams = heuristic
    ? byDir.map(({ dir }) => {
        const layers = { unit: 0, contract: 0, journey: 0, ground: 0 };
        layers[guessLayer(dir)] = '~';
        return { seam: dir, layers };
      })
    : seams;

  return { total, byDir, tagged: { seams: renderedSeams, count: renderedSeams.length }, taggingAdopted, heuristic };
}

export { LAYERS, guessLayer };
