#!/usr/bin/env bash
# Fixture repo for the architecture drift eval: docs/ already looks like it came from a prior run
# (the managed marker, a hand-authored model, and an empty accepted-debt baseline) while the
# source now carries one import edge (cli -> util) the hand model never declared.
set -e
mkdir -p src/cli src/core src/web src/util docs/reference docs/architecture/model .github/workflows
printf '%s\n' '{ "name": "acme-tool", "version": "0.4.0", "type": "module", "bin": { "acme": "src/cli/main.js" }, "dependencies": { "express": "^4.19.0" } }' > package.json
echo "import { run } from '../core/run.js'; import { serve } from '../web/server.js'; import { helper } from '../util/helper.js'; import express from 'express'; run(); serve(express); helper();" > src/cli/main.js
echo "export const run = () => 1;" > src/core/run.js
echo "import { run } from '../core/run.js'; export const serve = (app) => run(); const token = process.env.ACME_API_TOKEN;" > src/web/server.js
echo "import { serve } from '../web/server.js'; export const back = serve;" > src/core/back.js
echo "export const helper = () => 1;" > src/util/helper.js
printf 'name: ci\non:\n  push:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n' > .github/workflows/ci.yml
printf 'managed by arch — generated files live here\n' > docs/reference/.arch-managed
cat > docs/architecture/model/hand.c4 << 'C4'
// seeded by arch run from the generated graph — annotate freely; arch never overwrites this file
model {
  human operator 'Human operator'
  operator -> system 'uses'
  system system 'acme-tool' {
    cli -> core 'uses'
    cli -> web 'uses'
    web -> core 'uses'
    core -> web 'calls back'
  }
}
C4
printf '{"edges": []}\n' > docs/architecture/drift-baseline.json
git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init
