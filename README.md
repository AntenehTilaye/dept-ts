# DeptTS — Department Management Tool Suite

A "department operating system" for academic departments: committees and tasks, course portfolios
with assessment results and CQI, staff evaluation, add/drop and elective demand, instructor
preferences, invigilation and lab scheduling, resources, appointments and cases, meetings and
minutes, annual plans and quarterly reports — built on one platform kernel (workflow, forms and
campaigns, work items, scheduler and notifications, templates, documents, audit) so that a
System Administrator can compose a new process feature from a form.

## Everything runs in Docker

The host only needs Docker Desktop and git. Every Node command, and every git command that writes,
runs inside the `web` container on Node 22 (`docker compose run --rm web ...`). The host `git` is used
only for `push`, `pull`, `fetch` and read-only `status`/`log`; run `git config core.fileMode false`
once on the host so bind-mount modes never show as changes.

| Step | Command |
| --- | --- |
| First start | `docker compose build web worker` · `docker compose run --rm web npm ci` · `docker compose run --rm web npx prisma migrate dev` · `docker compose run --rm web npx prisma db seed` · `docker compose up -d web worker` |
| App / mail | http://localhost:3000 · http://localhost:8025 (Mailpit) |
| Checks | `docker compose run --rm web npm run check` |
| Unit + components | `docker compose --profile test run --rm test npx vitest run --project unit --project components` |
| Integration + worker | `docker compose --profile test run --rm test npx vitest run --project integration --project worker --coverage` |
| Everything with coverage thresholds | `docker compose --profile test run --rm test npm run test:coverage` |
| End-to-end | `docker compose -f compose.yaml -f compose.e2e.yaml up -d --wait web worker` · `docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e run --rm e2e npx playwright test` · `docker compose -f compose.yaml -f compose.e2e.yaml down` |
| All guard rails | `.\scripts\verify.ps1` (PowerShell) or `scripts/verify.sh` |
| New migration | `docker compose run --rm web npx prisma migrate dev --create-only --name <name>` → (tenant tables) `docker compose run --rm web sh -c "npx tsx prisma/scripts/gen-rls.ts --append prisma/migrations/*_<name>/migration.sql"` → `docker compose run --rm web npx prisma migrate dev` → `docker compose run --rm web npx prisma generate` |
| Add a dependency | `docker compose run --rm web npm install <pkg>` then `docker compose restart web worker` |
| Commit a phase | `docker compose run --rm web git add -A` · `docker compose run --rm web git commit -m "..."` |
| psql | `docker compose exec db psql -U dept_migrator -d dept` |
| Reset the database only | `docker compose down` · `docker volume rm deptts_pgdata` · start again (never `down -v`: that also deletes the `node_modules` volume) |

Copy `.env.example` to `.env` (gitignored) once; everything else is set by `compose.yaml`.

## Layout

- `src/platform/*` — framework-free kernel services (never import Next or React).
- `src/modules/*` — thin feature modules: adapters, surfaces, actions, queries, reports.
- `src/features/*`, `src/app/*` — the generic feature runtime, the admin builder and the routes.
- `apps/worker` — the pg-boss worker (own entrypoint, same package).
- `prisma/schema/*.prisma` — multi-file schema; `prisma/scripts/gen-rls.ts` generates the
  row-level-security policies from it and `prisma/rls-manifest.json` records the classification.
- `tests/{unit,components,integration,worker,e2e}` — see `vitest.config.ts` and `playwright.config.ts`.
- `docs/design` — the architecture blueprint, feature-builder design, schema, infrastructure and the
  phase-by-phase plan this repository is built from.

## Windows notes

Docker Desktop with the WSL2 backend. `node_modules`, `.next`, uploads and the database live in
named volumes; the source is bind-mounted with polling file watchers. If HMR misses edits, use
`docker compose watch` (sync mode) or clone the repository into the WSL2 filesystem and run the
same commands there.
