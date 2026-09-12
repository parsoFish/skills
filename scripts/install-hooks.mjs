#!/usr/bin/env node
// Install the pre-push hook that runs the skill gate for changed skills. Idempotent.
import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = join(ROOT, '.git', 'hooks');
if (!existsSync(join(ROOT, '.git'))) { console.error('not a git checkout'); process.exit(1); }
mkdirSync(hooks, { recursive: true });
const hook = `#!/bin/sh
# skills gate: any added or changed skill must have a valid attestation before it leaves this machine.
# This verifies the existing attestation (deterministic checks + attest verify) — it never spends
# money or runs the agentic half itself. Run \`npm run gate\` first if this fails.
exec node scripts/gate.mjs --verify-only --base "@{upstream}"
`;
writeFileSync(join(hooks, 'pre-push'), hook); chmodSync(join(hooks, 'pre-push'), 0o755);
console.log('installed .git/hooks/pre-push → node scripts/gate.mjs --verify-only');
