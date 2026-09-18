# Guard rails run before every phase commit. Only `docker compose ...` invocations: nothing
# runs on host Node. Exits non-zero on the first failure.
#   .\scripts\verify.ps1            # steps 1-4
#   .\scripts\verify.ps1 -Prod      # also step 5 (production image build)
#   .\scripts\verify.ps1 -SkipE2E   # steps 1-3 only
param(
  [switch]$Prod,
  [switch]$SkipE2E
)
$ErrorActionPreference = "Stop"

function Step($name, [scriptblock]$block) {
  Write-Host ""
  Write-Host "==> $name" -ForegroundColor Cyan
  & $block
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $name" -ForegroundColor Red; exit $LASTEXITCODE }
}

Step "1/5 validate, schema:check, typegen, tsc, eslint, rls:check" {
  docker compose run --rm web sh -c "npx prisma validate && npm run schema:check && npx next typegen && npx tsc --noEmit && npx eslint . && npm run rls:check"
}
Step "2/5 unit + component tests" {
  docker compose --profile test run --rm test npx vitest run --project unit --project components
}
Step "3/5 integration + worker tests with coverage" {
  docker compose --profile test run --rm test npx vitest run --project integration --project worker --coverage
}
if (-not $SkipE2E) {
  Step "4/5 end-to-end (production build on dept_e2e)" {
    docker compose -f compose.yaml -f compose.e2e.yaml up -d --wait web worker
    if ($LASTEXITCODE -ne 0) { docker compose -f compose.yaml -f compose.e2e.yaml logs web; exit 1 }
    docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e run --rm e2e npx playwright test
    $e2e = $LASTEXITCODE
    docker compose -f compose.yaml -f compose.e2e.yaml down
    if ($e2e -ne 0) { exit $e2e }
  }
}
if ($Prod) {
  Step "5/5 production images build" {
    docker compose -f compose.prod.yaml build web worker
  }
}
Write-Host ""
Write-Host "verify: all steps green" -ForegroundColor Green
