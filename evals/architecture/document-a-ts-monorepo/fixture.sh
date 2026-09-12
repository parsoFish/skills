#!/usr/bin/env bash
# Fixture repo for the architecture eval: three components, one cycle, one unused dep, one env var, one CI job.
set -e
mkdir -p src/cli src/core src/web .github/workflows
printf '%s\n' '{ "name": "acme-tool", "version": "0.3.0", "type": "module", "bin": { "acme": "src/cli/main.js" }, "dependencies": { "express": "^4.19.0", "leftpad": "^1.3.0" } }' > package.json
echo "import { run } from '../core/run.js'; import { serve } from '../web/server.js'; import express from 'express'; run(); serve(express);" > src/cli/main.js
echo "export const run = () => 1;" > src/core/run.js
echo "import { run } from '../core/run.js'; export const serve = (app) => run(); const token = process.env.ACME_API_TOKEN;" > src/web/server.js
echo "import { serve } from '../web/server.js'; export const back = serve;" > src/core/back.js
printf 'name: ci\non:\n  push:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n' > .github/workflows/ci.yml
git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init
