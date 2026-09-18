#!/usr/bin/env sh
# POSIX twin of verify.ps1 (Git Bash / WSL / CI). Usage: scripts/verify.sh [--prod] [--skip-e2e]
set -eu
PROD=0; SKIP_E2E=0
for a in "$@"; do case "$a" in --prod) PROD=1;; --skip-e2e) SKIP_E2E=1;; esac; done

echo "==> 1/5 validate, schema:check, typegen, tsc, eslint, rls:check"
docker compose run --rm web sh -c "npx prisma validate && npm run schema:check && npx next typegen && npx tsc --noEmit && npx eslint . && npm run rls:check"
echo "==> 2/5 unit + component tests"
docker compose --profile test run --rm test npx vitest run --project unit --project components
echo "==> 3/5 integration + worker tests with coverage"
docker compose --profile test run --rm test npx vitest run --project integration --project worker --coverage
if [ "$SKIP_E2E" = 0 ]; then
  echo "==> 4/5 end-to-end"
  docker compose -f compose.yaml -f compose.e2e.yaml up -d --wait web worker
  set +e
  docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e run --rm e2e npx playwright test
  code=$?
  set -e
  docker compose -f compose.yaml -f compose.e2e.yaml down
  [ "$code" = 0 ] || exit "$code"
fi
if [ "$PROD" = 1 ]; then
  echo "==> 5/5 production images build"
  docker compose -f compose.prod.yaml build web worker
fi
echo "verify: all steps green"
