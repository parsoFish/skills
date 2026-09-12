// Render a LikeC4 model to PNG views, then optionally postprocess (white background, downsize)
// with a plain PIL script. Every subprocess call goes through an injectable `exec` so tests never
// shell out to npx/likec4 or a real python3.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

// Pinned in tools.json (repo/plugin root) so every tool version lives in exactly one place.
const LIKEC4 = `likec4@${JSON.parse(readFileSync(new URL('../../../../tools.json', import.meta.url), 'utf8')).likec4}`;
const MAX_WIDTH = 1800;

const POSTPROCESS_PY = `
import sys, os
from PIL import Image

out_dir = sys.argv[1]
max_w = ${MAX_WIDTH}
for name in sorted(os.listdir(out_dir)):
    if not name.lower().endswith('.png'):
        continue
    path = os.path.join(out_dir, name)
    img = Image.open(path).convert('RGBA')
    bg = Image.new('RGB', img.size, (255, 255, 255))
    bg.paste(img, mask=img.split()[3])
    if bg.width > max_w:
        h = round(bg.height * max_w / bg.width)
        bg = bg.resize((max_w, h))
    bg.save(path)
`;

/** Default exec: spawnSync wrapped to the {status, stdout, stderr} shape every caller expects. */
export function defaultExec(cmd, args, opts = {}) {
  opts = { timeout: 180_000, ...opts };
  const r = spawnSync(cmd, args, { encoding: 'utf8', input: opts.input, maxBuffer: 1 << 28, timeout: opts.timeout });
  if (r.error) return { status: 1, stdout: '', stderr: String(r.error.message) };
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function fail(step, r) {
  throw new Error(`arch render: ${step} failed (exit ${r.status})\n${r.stderr}`);
}

/**
 * modelDir: directory with the .c4 model. outDir: where PNGs land.
 * exec: injectable subprocess runner, default spawnSync-backed. theme: LikeC4 export theme.
 * postprocess: composite onto white + downsize with PIL, best-effort (skipped, not thrown, if
 * PIL is unavailable).
 */
/** Fast offline probe: is likec4 runnable without a network install? (`npx --no-install` fails immediately when it is not cached.) */
export function likec4Available(exec = defaultExec) {
  const r = exec('npx', ['--no-install', LIKEC4, '--version']);
  if (r.status === 0) return true;
  // only a definite "not installed / no network" answer counts as unavailable; anything else falls through to validate, which reports its own error
  return !/could not determine executable|not found|ENOENT|E404|ENOTFOUND|EAI_AGAIN|network/i.test(`${r.stderr ?? ''}${r.stdout ?? ''}`);
}

export function render({ modelDir, outDir, exec = defaultExec, theme = 'light', postprocess = true }) {
  const notes = [];
  if (!likec4Available(exec)) {
    return { views: [], validated: false, postprocessed: false, notes: [`likec4 is not available offline (npx --no-install ${LIKEC4} failed): views not rendered — run once with network access or install it (npm i -g ${LIKEC4}) and re-run \`arch run\``] };
  }

  const validated = exec('npx', ['--yes', LIKEC4, 'validate', modelDir]);
  if (validated.status !== 0) fail('validate', validated);

  const exported = exec('npx', ['--yes', LIKEC4, 'export', 'png', modelDir, '-o', outDir, '--theme', theme, '--flat', '--ignore', '--notation']);
  if (exported.status !== 0) fail('export png', exported);

  let postprocessed = false;
  if (!postprocess) {
    notes.push('postprocess disabled by caller');
  } else {
    const pil = exec('python3', ['-c', 'import PIL']);
    if (pil.status !== 0) {
      notes.push('python3 PIL not available; skipped postprocessing');
    } else {
      const ran = exec('python3', ['-', outDir], { input: POSTPROCESS_PY });
      if (ran.status !== 0) {
        notes.push(`postprocess script failed: ${ran.stderr}`);
      } else {
        postprocessed = true;
      }
    }
  }

  const views = readdirSync(outDir).filter(f => f.toLowerCase().endsWith('.png')).sort();
  return { views, validated: true, postprocessed, notes };
}
