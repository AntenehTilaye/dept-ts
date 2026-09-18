SOURCE: repair:infra

===== repoLayout =====
 ## Decision: one npm package, plain `src/`, worker as a second entrypoint (no npm workspaces)

Reasons (all specific to the fixed stack):
1. Prisma 7.10's `prisma-client` generator writes ESM into `src/generated/prisma`; with one package the web app (`@/generated/prisma/client`) and the worker (`tsx` with the same `paths`) import the identical generated module, one `@prisma/client` copy, one `pg` pool factory. Workspaces would need `transpilePackages`/duplicate-React care in Turbopack and a hoisting-sensitive generator path.
2. One `package-lock.json`, one `npm ci`, one `node_modules` named volume: the single slowest operation on a Windows bind mount happens once.
3. The blueprint forbids modules from re-implementing services; a flat `src/platform` + `src/modules` split with an ESLint `no-restricted-imports` rule (`src/modules/**` may import `src/platform/**`, never the reverse; `src/platform/**` may not import `next/*`, `react`, `server-only`) is enforceable with one config.
4. `apps/worker/` keeps the plan's name for the worker process but is a **directory of the root package** (own `tsconfig.json` that `extends` the root one; no `package.json`). Next never compiles it because nothing under `src/app` imports it; `tsc --noEmit` covers it because the root tsconfig includes it. Its entrypoint is `apps/worker/src/index.ts` (never `main.ts`).
5. All tests live under one `tests/` tree (`tests/unit`, `tests/components`, `tests/integration`, `tests/worker`, `tests/e2e`): one coverage glob, one boundary-lint ignore, and Playwright's `testDir` is `tests/e2e` (the `*.spec.ts` suffix keeps Vitest and Playwright from picking up each other's files).

### Canonical names used by every other part (fixed here)
| Concern | File | Exports |
|---|---|---|
| Root Prisma client (unscoped, `dept_app` role) | `src/lib/db/prisma.ts` | `prismaRoot` |
| Department-scoped client | `src/lib/db/scoped.ts` | `forDepartment(departmentId)` (query extension injecting `departmentId`), `getDb()` (request-scoped, `React.cache`) |
| Tenant transactions | `src/lib/db/tenant.ts` | `withTenantTx(departmentId, fn)` (`set_config('app.current_department_id', $1, true)` at tx start), `withTenantBypass(reason, fn)` (sets `app.tenant_bypass='on'`, audit-logs) |
| Send-only pg-boss | `src/lib/db/boss.ts` | `getBoss()` (lazy singleton), `ensureQueues()` |
| Session/permission helpers | `src/lib/auth/require.ts` | `requireContext()`, `requireDeptContext(slug)`, `requireAdmin()`, `requireCan(permissionKey, subjectRef?)` |
| Worker entry | `apps/worker/src/index.ts` | — |
| Worker handlers | `apps/worker/src/handlers/<queue-with-hyphens>.ts` | one default export per queue (`outbox-dispatch.ts` for `outbox.dispatch`, …) |
| Public routes | `src/app/c/[token]`, `src/app/a/[hostSlug]`, `src/app/api/uploads`, `src/app/api/documents/[id]/v/[versionNo]/download` | — |
| Department segment | `src/app/(app)/d/[dept]/…` (`dept` = Department.slug) | login redirect target `/select-department` |
| Ids | text `cuid()` everywhere; `Department.id === better-auth organization.id`; RLS compares text | — |
| Column naming | `@@map(snake_case)` / `@map(snake_case)` on every model/column; all hand-written SQL uses snake_case; `gen-rls.ts` reads `dbName` from the DMMF | — |

```
DeptTS/
├─ .git/                                  # created in P0 by `docker compose run --rm web git init -b main`
├─ .gitignore  .gitattributes             # `* text=auto eol=lf`; ignore node_modules .next src/generated .env .env.test tests/e2e/.auth tests/e2e/.results coverage
├─ .dockerignore                          # node_modules .next .git tests/e2e/.results coverage *.md
├─ .editorconfig  README.md  .env.example  .env.test.example
├─ package.json                           # "type":"module", "engines":{"node":">=22.12"}, no "workspaces"
├─ package-lock.json
├─ .npmrc                                 # save-exact=true (Prisma 7.10.0 / Playwright 1.63.0 must stay pinned)
├─ tsconfig.json                          # strict, moduleResolution bundler, paths {"@/*":["./src/*"]}, plugins [{name:"next"}],
│                                         # include: next-env.d.ts, .next/types/**/*.ts, src/**/*, apps/worker/**/*, prisma/**/*, tests/**/*
├─ next.config.ts                         # output: process.env.NEXT_OUTPUT==='standalone' ? 'standalone' : undefined,
│                                         # typedRoutes:true, serverExternalPackages:['@prisma/client','pg','pg-boss','nodemailer'],
│                                         # experimental: {} (no cacheComponents), NO webpack key, images: {unoptimized:true}
├─ postcss.config.mjs  components.json    # shadcn (base radix, css src/app/globals.css, aliases @/components, @/lib/utils)
├─ eslint.config.mjs  prettier.config.mjs # flat config, eslint-config-next/core-web-vitals + /typescript + prettier/flat, boundary rules (reason 3)
├─ vitest.config.ts                       # test.projects: unit | components | integration | worker (see testingStrategy); tests/e2e excluded
├─ playwright.config.ts                   # testDir 'tests/e2e', baseURL from BASE_URL, no webServer (compose provides it)
├─ prisma.config.ts                       # see below
├─ compose.yaml  compose.e2e.yaml  compose.prod.yaml   # dev stack; e2e override (production build of web on dept_e2e); production
├─ docker/
│  ├─ web.Dockerfile                      # node:22-bookworm-slim (+git): targets dev | deps | builder | migrate | runner (standalone)
│  ├─ worker.Dockerfile                   # mcr.microsoft.com/playwright:v1.63.0-noble: targets dev | builder | runner
│  └─ postgres/init.sql                   # roles dept_migrator (LOGIN CREATEDB BYPASSRLS, owner) + dept_app (LOGIN NOBYPASSRLS), DBs dept/dept_test/dept_e2e, pgboss schema, default privileges
├─ scripts/
│  ├─ verify.ps1  verify.sh               # host wrappers: ONLY `docker compose ...` invocations (lint, typecheck, rls:check, unit, integration+worker, e2e, prod build)
│  ├─ test-db.sh                          # inside container: create per-run schema, default privileges, migrate deploy
│  └─ wait-for.sh
├─ prisma/
│  ├─ schema/
│  │  ├─ schema.prisma                    # datasource db { provider="postgresql" } (no url) + generator (below)
│  │  ├─ enums.prisma                     # SubjectType (merged list incl. feature_definition, feature_record, feature_step_instance, term, calendar_period,
│  │  │                                   # enrollment, form_definition, campaign_invitation, comment, template, availability_block, report, generated_report ...),
│  │  │                                   # ScopeType, PermissionLevel (… none), LinkRole, NotificationCategory, JobStatus (scheduled|sent|running|done|failed|cancelled),
│  │  │                                   # ImportKind, TaskKind (incl. feature_step), CampaignKind, AnonymityMode, GroupKind, BlockKind (incl. blackout), Severity, AdapterHook
│  │  ├─ auth.prisma                      # generated by `npx auth@latest generate` (User, Session, Account, Verification, Organization, Member, Invitation) — committed, never hand-edited; no user.personId (link is Person.userId)
│  │  ├─ identity.prisma  people.prisma (Person global + DepartmentPerson, StaffProfile, Student, Program, Section, ...)  academic.prisma  workflow.prisma  workitem.prisma  forms.prisma
│  │  ├─ campaign.prisma  scheduler.prisma  notification.prisma (incl. Announcement)  template.prisma  document.prisma  thread.prisma
│  │  ├─ audit.prisma (AuditEvent, DomainEvent, EventHandlerReceipt)  import.prisma  availability.prisma  reporting.prisma  search.prisma  dashboard.prisma
│  │  ├─ feature.prisma                   # FeatureDefinition, FeatureDefinitionVersion, FeatureRecord, FeatureStepInstance, FeatureNumberSequence, FeatureMigration, AdapterRegistration
│  │  ├─ committee.prisma  portfolio.prisma  meeting.prisma (Meeting*, Appointment)          # milestone-1 module tables
│  │  └─ planning.prisma  load.prisma  scheduling.prisma  resource.prisma   # later milestones (files exist from P1, models added in their phases)
│  ├─ migrations/                         # Prisma-timestamped folders `<yyyymmddhhmmss>_<name>`; the <name> is the `--name` given in that phase:
│  │  ├─ <ts>_init/                       # P0 `migrate dev --name init` (whatever models exist at P0)
│  │  ├─ <ts>_extensions/migration.sql    # P1, hand-written: ONLY `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS btree_gist;` (no roles, no pgboss schema)
│  │  ├─ <ts>_<models>/                   # per phase, prisma-generated (`migrate dev --create-only` for phases that add tenant tables)
│  │  ├─ <ts>_rls_p<N>/                   # per phase, GENERATED by prisma/scripts/gen-rls.ts --append (ENABLE + FORCE ROW LEVEL SECURITY + policy per new tenant table, snake_case names from DMMF dbName)
│  │  ├─ <ts>_people_constraints/         # P3: partial unique index section_representative(section_id) WHERE is_primary
│  │  ├─ <ts>_append_only/                # P4: triggers + REVOKE UPDATE, DELETE ON audit_event, workflow_transition_log FROM dept_app; domain_event column-guard trigger (UPDATE may change only published_at, attempts, last_error, dead_at; DELETE only when published_at IS NOT NULL)
│  │  ├─ <ts>_document_locks/             # P6: REVOKE UPDATE, DELETE ON document_version FROM dept_app + SECURITY DEFINER document_version_lock(document_id, version_no, transition_log_id) and document_version_purge(document_id) owned by dept_migrator, EXECUTE granted to dept_app
│  │  ├─ <ts>_anonymity/                  # P8: CHECK + trigger on submission (respondent_person_id/invitation_id NULL when campaign anonymous)
│  │  ├─ <ts>_availability_exclusion/     # P10: EXCLUDE USING gist on availability_block (hard blocks, owner_type+owner_id, tstzrange(start_at,end_at))
│  │  └─ <ts>_search/                     # P11: tsvector generated columns + GIN, gin_trgm_ops indexes on search_index_entry.body_text etc.
│  ├─ rls-manifest.json                   # committed list of tenant tables (gen-rls --check compares)
│  ├─ scripts/gen-rls.ts                  # reads DMMF via @prisma/internals@7.10.0, uses model/field dbName; emits policy SQL; --check / --append <migration.sql>
│  ├─ scripts/check-schema.ts             # enforces @@map/@map snake_case on every model and column
│  ├─ seed.ts                             # orchestrates prisma/seed/* (idempotent upserts by key); runs as dept_migrator
│  └─ seed/
│     ├─ faculty.ts  departments.ts (via better-auth organization API so Department.id = organization.id)  users.ts  roles.ts  permissions.ts   # §30 matrix, DPT exclusion SystemSetting
│     ├─ calendar.ts  templates.ts  reminder-schedules.ts  forms/  workflows/
│     ├─ features/  {task,case,committee,committee_report,portfolio,campaign,meeting,appointment,...}.ts  # built-ins as FeatureDefinitions (shape = featureBuilder §1, steps per seededFeatures)
│     └─ demo/ (people, department-persons, courses, offerings, enrollments, timetable, tasks) — loaded when SEED_DEMO=1 (dev, e2e)
├─ src/
│  ├─ proxy.ts                            # getSessionCookie(request) from 'better-auth/cookies' → optimistic redirect only; authenticated /login → /select-department;
│  │                                      # matcher excludes api/auth, api/health, _next, c/, a/
│  ├─ generated/prisma/                   # gitignored output of `prisma generate`
│  ├─ lib/
│  │  ├─ auth/ {auth.ts (betterAuth + admin + organization + nextCookies last; user.additionalFields {}), client.ts, access.ts (createAccessControl, membership roles only — committee_chair is a RoleGrant-only derived role), require.ts (requireContext, requireDeptContext, requireAdmin, requireCan)}
│  │  ├─ db/ {prisma.ts (prismaRoot), scoped.ts (forDepartment, getDb), tenant.ts (withTenantTx, withTenantBypass), boss.ts (getBoss, ensureQueues)}
│  │  ├─ storage/ {provider.ts, local-disk.ts, s3-stub.ts}
│  │  ├─ mail/ {transport.ts (nodemailer from SMTP_URL), render.ts (react-email)}
│  │  ├─ actions/ safe-action.ts          # zod-validated server action wrapper: requireDeptContext, can(), audit correlationId
│  │  └─ utils.ts  zod/
│  ├─ platform/                           # services; framework-free (no react/next imports); each folder: index.ts (public API), types.ts, pure modules
│  │  ├─ subject-registry/  identity/ (can.ts, levels.ts, derive.ts, reconcile.ts)  people/  academic/ (calendar.ts, anchors.ts, offerings.ts, teaching.ts)
│  │  ├─ workflow/ (engine.ts, machine.ts (pure), schema.ts (State/Transition JSON contract incl. `compound` states with branches + completion all|quorum(n)|any, synthetic $join/$reject), parallel.ts, guards.ts, effects.ts, registry.ts)
│  │  ├─ workitem/  forms/ (definitions.ts, zod-from-fields.ts, submissions.ts, bindings.ts)  campaign/ (kinds/{evaluation,add_drop,elective,preference,survey}.ts, tokens.ts, aggregation.ts)
│  │  ├─ scheduler/ (enqueue.ts (fromPrisma + enqueue), reminders.ts (subscribeReminders + materialize), anchors.ts, ledger.ts (ScheduledJob), queues.ts (SHARED queue catalogue), notify.ts, inbox.ts, channels/{in-app,email}.ts)
│  │  ├─ template/ (mustache-safe.ts, variables.ts)  document/ (incl. lock.ts calling document_version_lock())  thread/  audit/ (interceptor.ts, outbox.ts, subscribers.ts, receipts.ts)
│  │  ├─ import/ (pipeline.ts, validators/, committers/, excel.ts, csv.ts)  availability/ (blocks.ts, conflicts.ts, free-slots.ts)
│  │  ├─ reporting/ (registry.ts, html.ts, xlsx.ts, csv.ts)  search/  dashboard/
│  │  └─ feature/ (schema.ts (Zod root per featureBuilder §1: schemaVersion, key, labels, navigation, scope, parentSubject, record{…backing}, presets, steps (StepDef | ParallelGroup{branches.mode static|dynamic} | StepGroup), terminalStates, listViews, dashboardCounters, report, permissions.defaults, lockedPaths),
│  │              validate.ts (rule codes per featureBuilder §4), compiler.ts, simulate.ts, migrate.ts, nav.ts, locked-paths.ts, seed-hash.ts,
│  │              runtime/{create.ts, act.ts, steps.ts, assignee.ts, deadline.ts}, adapters/{registry.ts (AdapterHook), ...})
│  ├─ modules/                            # thin: surface registry + actions + queries + adapters + seed definition
│  │  └─ <committees|tasks|portfolios|assessment|cqi|campaigns/{evaluation,add-drop,elective,preference,survey}|meetings|appointments|cases|
│  │      planning|load|invigilation|labs|resources|staff|communication>/ {surface.tsx, actions.ts, queries.ts, adapters.ts, components/}
│  ├─ features/ runtime/{list.tsx, detail.tsx, step-page.tsx, step-timeline.tsx, parallel-lanes.tsx, action-bar.tsx, actions.ts}
│  │             builder/{wizard/*, step-tree.tsx, workflow-graph.tsx, field-builder.tsx, lock-badge.tsx, simulate-panel.tsx, migrate-wizard.tsx}
│  ├─ components/ ui/ (shadcn)  layout/  forms/FormRenderer.tsx  data-table/  charts/
│  ├─ emails/ (react-email: BaseLayout.tsx, SetPassword.tsx, ResetPassword.tsx, Notification.tsx)
│  └─ app/
│     ├─ layout.tsx  globals.css  not-found.tsx
│     ├─ (auth)/ login/  reset-password/  set-password/  select-department/
│     ├─ (app)/d/[dept]/ layout.tsx  page.tsx (dashboard)  inbox/  my-work/  search/  calendar/  documents/  reports/
│     │   ├─ f/[featureKey]/ {page.tsx, new/, [recordId]/{page.tsx, history/, step/[stepKey]/}}     # generic feature runtime
│     │   └─ committees/ tasks/ portfolios/ assessment/ cqi/ campaigns/ meetings/ appointments/ cases/ people/ (+ later: plans/ invigilation/ labs/ resources/ staff/ load/ communication/)
│     ├─ (admin)/admin/ layout.tsx users/ departments/ permissions/ calendar/ templates/ forms/ workflows/ reminders/ export-specs/ settings/ audit/ jobs/
│     │   └─ features/ {page.tsx, new/, [key]/{edit/, versions/, simulate/, migrate/}}
│     ├─ c/[token]/                       # public campaign token link (no login)
│     ├─ a/[hostSlug]/                    # public appointment request form (no login)
│     └─ api/ auth/[...all]/route.ts  uploads/route.ts  documents/[id]/v/[versionNo]/download/route.ts  health/route.ts
├─ apps/worker/
│  ├─ tsconfig.json                       # extends ../../tsconfig.json; types ["node"]; include src/**/*
│  ├─ healthcheck.mjs                     # exits 1 if /tmp/worker-heartbeat older than 90 s
│  └─ src/ index.ts  boss.ts  registry.ts (registerHandlers)  schedules.ts  shutdown.ts
│           handlers/ {outbox-dispatch, reminder-materialize, reminder-fire, notification-deliver, email-send, email-dead, campaign-open, campaign-close,
│                      campaign-aggregate, workflow-auto-transition, recurrence-spawn, snapshot-compute, portfolio-provision, report-generate,
│                      feature-migrate, overdue-sweep, grant-reconcile, calendar-autotransition, retention-run, worker-heartbeat}.ts
│           pdf/ browser.ts (shared Chromium, p-limit PDF_CONCURRENCY)
└─ tests/
   ├─ unit/        (workflow/, feature/, forms/, scheduler/, template/, import/, metrics/, availability/, identity/)
   ├─ components/  (FormRenderer, StepTimeline, wizard forms, DataTable) — jsdom
   ├─ integration/ (tenancy/{rls-isolation,rls-coverage,append-only,scoped-client}.test.ts, identity/, workflow/, feature/{runtime,versioning,migration,seed}.test.ts, ...)
   ├─ worker/      (pg-boss real: enqueue-in-transaction, outbox-dispatch, reminders, campaign-open-close, auto-transition, snapshot-compute, report-pdf, feature-migrate, email)
   ├─ e2e/         (Playwright: global-setup.ts, fixtures/{auth,mailpit,users,feature}.ts, <phase>-<journey>.spec.ts, .auth/ and .results/ gitignored)
   ├─ setup/       {global-db.ts, global-boss.ts, db.ts (migratorDb, appDb, withDept), db-each.ts, reset-e2e.ts, factories.ts, seed-minimal.ts, truncate.ts, dom.ts}
   └─ fixtures/    (assessment-*.xlsx/.csv, timetable.csv, golden-load-export.xlsx, feature-definitions/*.json)
```

### Load-bearing file contents (Prisma 7.10 / Next 16.3)

`prisma/schema/schema.prisma`
```prisma
datasource db { provider = "postgresql" }
generator client {
  provider     = "prisma-client"
  output       = "../../src/generated/prisma"
  moduleFormat = "esm"
  runtime      = "nodejs"
}
```
`prisma.config.ts`
```ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: env("DATABASE_URL_MIGRATE") },
});
```
`src/lib/db/prisma.ts`
```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX ?? 10) },
                             { schema: process.env.DATABASE_SCHEMA ?? "public" });
export const prismaRoot: PrismaClient = globalThis.__prismaRoot ?? new PrismaClient({ adapter });
```
`src/lib/db/tenant.ts`
```ts
export async function withTenantTx<T>(departmentId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prismaRoot.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_department_id', ${departmentId}, true)`;
    return fn(tx);
  });
}
export async function withTenantBypass<T>(reason: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) { /* set_config('app.tenant_bypass','on',true) + audit row {action:'bypass', reason} */ }
```
`package.json` scripts: `"postinstall": "prisma generate"`, `"dev": "next dev -H 0.0.0.0 -p 3000"`, `"build": "next build"`, `"start": "next start -H 0.0.0.0 -p 3000"`, `"typecheck": "next typegen && tsc --noEmit"`, `"lint": "eslint ."`, `"worker:dev": "tsx watch --clear-screen=false apps/worker/src/index.ts"`, `"worker:build": "esbuild apps/worker/src/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=apps/worker/dist/index.js --external:pg --external:pg-boss --external:playwright --external:nodemailer --external:@prisma/client --external:exceljs-hardened"`, `"test:unit": "vitest run --project unit --project components"`, `"test:integration": "vitest run --project integration"`, `"test:worker": "vitest run --project worker"`, `"test:e2e": "playwright test"`, `"rls:check": "tsx prisma/scripts/gen-rls.ts --check"`, `"schema:check": "tsx prisma/scripts/check-schema.ts"`.

===== dockerDev =====
 ## Principle
Every Node command **and every git command that writes** runs inside a Compose container on Node 22. The host (Node 20) runs only `docker compose`, and host `git` is used solely for `push`/`pull`/`fetch` (credentials live on the host) and read-only `git status`/`git log`. Source is bind-mounted at `/app`; everything hot (`node_modules`, `.next`, uploads, Postgres data) lives in named volumes. Every command in the phase plan is therefore a `docker compose ...` form, including `git init`, `git add`, `git commit` and `git tag`.

## `compose.yaml`
```yaml
name: deptts
x-app-env: &app-env
  DATABASE_URL: postgresql://dept_app:dept_app@db:5432/dept
  DATABASE_URL_MIGRATE: postgresql://dept_migrator:dept_migrator@db:5432/dept
  BETTER_AUTH_URL: http://localhost:3000
  BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:-dev-only-secret-please-change-0123456789}
  SMTP_URL: smtp://mailpit:1025
  MAIL_FROM: "DeptTS <noreply@deptts.local>"
  MAILPIT_URL: http://mailpit:8025
  UPLOAD_DIR: /data/uploads
  APP_TIMEZONE: ${APP_TIMEZONE:-Africa/Addis_Ababa}     # the ONE timezone for cron, reminders and date rendering
  SEED_DEMO: "1"
  NEXT_TELEMETRY_DISABLED: "1"
x-git-env: &git-env
  GIT_AUTHOR_NAME: ${GIT_AUTHOR_NAME:-DeptTS Dev}
  GIT_AUTHOR_EMAIL: ${GIT_AUTHOR_EMAIL:-dev@deptts.local}
  GIT_COMMITTER_NAME: ${GIT_AUTHOR_NAME:-DeptTS Dev}
  GIT_COMMITTER_EMAIL: ${GIT_AUTHOR_EMAIL:-dev@deptts.local}

services:
  db:
    image: postgres:16
    environment: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: postgres }
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/10-init.sql:ro
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres -d dept"], interval: 5s, timeout: 3s, retries: 30 }

  mailpit:
    image: axllent/mailpit
    ports: ["8025:8025", "1025:1025"]
    environment: { MP_SMTP_AUTH_ACCEPT_ANY: "1", MP_SMTP_AUTH_ALLOW_INSECURE: "1" }

  web:
    build: { context: ., dockerfile: docker/web.Dockerfile, target: dev }
    command: npm run dev
    ports: ["3000:3000"]
    env_file: [{ path: .env, required: false }]
    environment:
      <<: [*app-env, *git-env]
      WATCHPACK_POLLING: "true"
      CHOKIDAR_USEPOLLING: "true"
    volumes:
      - .:/app
      - node_modules:/app/node_modules
      - next_dev:/app/.next
      - uploads:/data/uploads
    depends_on: { db: { condition: service_healthy }, mailpit: { condition: service_started } }
    healthcheck: { test: ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""], interval: 10s, retries: 30, start_period: 90s }

  worker:
    build: { context: ., dockerfile: docker/worker.Dockerfile, target: dev }
    command: npm run worker:dev
    init: true
    ipc: host
    env_file: [{ path: .env, required: false }]
    environment: { <<: *app-env }
    volumes: [ .:/app, node_modules:/app/node_modules, uploads:/data/uploads ]
    depends_on: { db: { condition: service_healthy }, mailpit: { condition: service_started } }
    healthcheck: { test: ["CMD", "node", "apps/worker/healthcheck.mjs"], interval: 30s, retries: 3, start_period: 60s }

  test:                                   # Vitest (unit, components, integration, worker). Playwright image so the pdf handler test has Chromium.
    profiles: ["test"]
    build: { context: ., dockerfile: docker/worker.Dockerfile, target: dev }
    init: true
    ipc: host
    env_file: [{ path: .env.test, required: false }]
    environment:
      <<: *app-env
      DATABASE_URL: postgresql://dept_app:dept_app@db:5432/dept_test
      DATABASE_URL_MIGRATE: postgresql://dept_migrator:dept_migrator@db:5432/dept_test
      UPLOAD_DIR: /tmp/uploads
      SEED_DEMO: "0"
      CI: "true"
    volumes: [ .:/app, node_modules:/app/node_modules ]
    depends_on: { db: { condition: service_healthy }, mailpit: { condition: service_started } }

  e2e:                                    # Playwright runner; hits web over the compose network
    profiles: ["e2e"]
    build: { context: ., dockerfile: docker/worker.Dockerfile, target: dev }
    init: true
    ipc: host
    environment:
      BASE_URL: http://web:3000
      MAILPIT_URL: http://mailpit:8025
      DATABASE_URL_MIGRATE: postgresql://dept_migrator:dept_migrator@db:5432/dept_e2e
      CI: "true"
    volumes: [ .:/app, node_modules:/app/node_modules ]
    depends_on: { web: { condition: service_healthy }, worker: { condition: service_started } }

volumes: { pgdata: {}, node_modules: {}, next_dev: {}, next_e2e: {}, uploads: {}, uploads_e2e: {} }
```

## `compose.e2e.yaml` (override; production build of `web`, separate DB and volumes so dev data/`.next` never collide)
```yaml
services:
  web:
    command: sh -c "npx prisma migrate deploy && npx prisma db seed && npm run build && npm run start"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://dept_app:dept_app@db:5432/dept_e2e
      DATABASE_URL_MIGRATE: postgresql://dept_migrator:dept_migrator@db:5432/dept_e2e
      BETTER_AUTH_URL: http://web:3000
      BETTER_AUTH_TRUSTED_ORIGINS: http://localhost:3000
      SEED_DEMO: "1"
    volumes: [ .:/app, node_modules:/app/node_modules, next_e2e:/app/.next, uploads_e2e:/data/uploads ]
  worker:
    environment: { DATABASE_URL: postgresql://dept_app:dept_app@db:5432/dept_e2e, UPLOAD_DIR: /data/uploads }
    volumes: [ .:/app, node_modules:/app/node_modules, uploads_e2e:/data/uploads ]
```
`next start` is valid here because `output: 'standalone'` is only switched on by `NEXT_OUTPUT=standalone` in the production Dockerfile.

## `docker/postgres/init.sql` (runs once when the `pgdata` volume is created; the ONLY place roles are created)
```sql
CREATE ROLE dept_migrator LOGIN PASSWORD 'dept_migrator' CREATEDB BYPASSRLS;
CREATE ROLE dept_app      LOGIN PASSWORD 'dept_app' NOBYPASSRLS;
CREATE DATABASE dept      OWNER dept_migrator;
CREATE DATABASE dept_test OWNER dept_migrator;
CREATE DATABASE dept_e2e  OWNER dept_migrator;
\c dept
CREATE EXTENSION IF NOT EXISTS pg_trgm;  CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA pgboss AUTHORIZATION dept_app;                 -- pg-boss migrates its own schema as dept_app; Prisma never declares or touches it
GRANT USAGE ON SCHEMA public TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO dept_app;
\c dept_e2e
-- identical block
\c dept_test
-- identical block, plus:
GRANT CREATE ON DATABASE dept_test TO dept_app;             -- worker tests create pgboss_it_<runid> schemas as dept_app
```
Rules that follow from this:
- `dept_migrator` owns every table and has `BYPASSRLS`, so `migrate deploy`, seeds and test resets work under `FORCE ROW LEVEL SECURITY`; `dept_app` (web + worker + integration tests) can never bypass at the role level. Policies are `department_id = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on'` (text compare, ids are cuid text); only `withTenantBypass()` in `src/lib/db/tenant.ts` sets the bypass flag (global-admin faculty pages, `grant.reconcile`, `retention.run`), and it audit-logs each use.
- Migrations never `CREATE ROLE` or `CREATE SCHEMA pgboss` (cluster-wide / breaks per-run schemas). The extensions migration only repeats the `CREATE EXTENSION IF NOT EXISTS` lines for portability.
- Append-only tables (`<ts>_append_only`, P4): `REVOKE UPDATE, DELETE ON audit_event, workflow_transition_log FROM dept_app` plus BEFORE UPDATE/DELETE triggers that raise. **`domain_event` is NOT in the REVOKE list** because the worker (`dept_app`) must mark rows published; its immutability is a column-guard trigger: an UPDATE may change only `published_at`, `attempts`, `last_error`, `dead_at`; a DELETE is allowed only when `published_at IS NOT NULL` (retention). `document_version` (`<ts>_document_locks`, P6) is REVOKE'd UPDATE/DELETE for `dept_app`; locking and retention purge go through `SECURITY DEFINER` functions `document_version_lock(document_id, version_no, transition_log_id)` and `document_version_purge(document_id)` owned by `dept_migrator` with EXECUTE granted to `dept_app`. Functions in migrations are created unqualified so they land in the per-run test schema too.

## Dockerfiles
`docker/web.Dockerfile`
```dockerfile
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates git && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory /app && git config --system core.fileMode false && git config --system core.autocrlf false && git config --system init.defaultBranch main
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dev                      # bind-mounted source; node_modules from the named volume; git available for in-container commits
EXPOSE 3000
CMD ["npm","run","dev"]

FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma                  # postinstall runs `prisma generate`, so the schema must be present
RUN npm ci

FROM deps AS builder
COPY . .
ENV NEXT_OUTPUT=standalone
RUN npx prisma generate && npm run build

FROM base AS migrate                  # one-off: docker compose run --rm migrate  (prod: image target migrate)
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
CMD ["npx","prisma","migrate","deploy"]

FROM node:22-bookworm-slim AS runner  # no Chromium, no git, no dev deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node","server.js"]
```
`docker/worker.Dockerfile`
```dockerfile
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS dev     # Node 22 + Chromium
WORKDIR /app
ENV NODE_ENV=development
CMD ["npm","run","worker:dev"]

FROM dev AS builder
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate && npm run worker:build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/healthcheck.mjs ./apps/worker/healthcheck.mjs
USER pwuser
CMD ["node","apps/worker/dist/index.js"]
```
`compose.prod.yaml`: services `web` (target runner), `worker` (target runner, `init: true`, `ipc: host`), `db`, `migrate` (target migrate, `profiles: [ops]`) and an SMTP relay instead of Mailpit; volumes `uploads` and `pgdata` only; secrets from the host environment or Docker secrets. Run: `docker compose -f compose.prod.yaml up -d`.

## Env files
- `.env.example` (committed): `BETTER_AUTH_SECRET=`, `APP_TIMEZONE=Africa/Addis_Ababa` (single timezone for `boss.schedule`, reminders and date rendering; confirm with the user before the scheduler phase), `PG_POOL_MAX=10`, `WORKER_CONCURRENCY=4`, `PDF_CONCURRENCY=2`, `UPLOAD_MAX_MB=25`, `GIT_AUTHOR_NAME=`, `GIT_AUTHOR_EMAIL=`, comments saying everything else is set by `compose.yaml`. Copy to `.env` (gitignored) once.
- `.env.test.example` → `.env.test`: `KEEP_TEST_SCHEMA=0`, `TEST_LOG=warn`.
- Secrets never go into compose files.

## Everyday commands (PowerShell on the host; every one is `docker compose ...`)
| Step | Command |
|---|---|
| P0 bootstrap | `docker compose build web worker` ; `docker compose run --rm web git init -b main` ; `docker compose run --rm web npm ci` (writes `package-lock.json` to the bind mount, `node_modules` to the volume, runs `prisma generate`) ; `docker compose run --rm web npx prisma migrate dev --name init` ; `docker compose run --rm web npx prisma db seed` ; `docker compose up -d web worker` → http://localhost:3000, Mailpit http://localhost:8025 |
| Later first runs | `docker compose run --rm web npx prisma migrate deploy` ; `docker compose run --rm web npx prisma db seed` ; `docker compose up -d web worker` |
| Commit a phase | `docker compose run --rm web git add -A` ; `docker compose run --rm web git commit -m "feat(x): ..."` ; tags: `docker compose run --rm web git tag -a v0.<phase> -m "..."` ; push from the host: `git push --follow-tags` |
| Add a dependency | `docker compose run --rm web npm install <pkg>` (then `docker compose restart web worker`) |
| Add shadcn component | `docker compose run --rm web npx shadcn@latest add button dialog ...` |
| Generate better-auth models | `docker compose run --rm web npx auth@latest generate --config src/lib/auth/auth.ts --output prisma/schema/auth.prisma` |
| New migration | `docker compose run --rm web npx prisma migrate dev --name <name>` (Prisma-generated SQL) — for a phase that adds tenant tables: `... migrate dev --create-only --name <name>` then `docker compose run --rm web npx tsx prisma/scripts/gen-rls.ts --append prisma/migrations/<ts>_<name>/migration.sql` then `... migrate dev` ; hand-written SQL: `... migrate dev --create-only --name <name>`, edit `migration.sql`, `... migrate dev` ; finish with `docker compose run --rm web npx prisma generate` |
| Reset dev DB | `docker compose run --rm web npx prisma migrate reset --force` (runs seed) |
| Type-check + lint | `docker compose run --rm web sh -c "npx prisma validate && npm run schema:check && npx next typegen && npx tsc --noEmit && npx eslint ."` |
| RLS manifest check | `docker compose run --rm web npm run rls:check` |
| Unit + component tests | `docker compose --profile test run --rm test npx vitest run --project unit --project components` |
| Integration tests | `docker compose --profile test run --rm test npx vitest run --project integration` (global setup creates schema `it_<runid>` in `dept_test`, migrates, seeds minimal, drops at the end unless `KEEP_TEST_SCHEMA=1`) |
| Worker tests | `docker compose --profile test run --rm test npx vitest run --project worker` |
| Coverage | `docker compose --profile test run --rm test npx vitest run --coverage` (all projects) |
| E2E | `docker compose -f compose.yaml -f compose.e2e.yaml up -d --wait web worker` ; `docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e run --rm e2e npx playwright test` ; report in `tests/e2e/.results/` ; `docker compose -f compose.yaml -f compose.e2e.yaml down` (dev stack restarts with plain `docker compose up -d web worker`) |
| Full verify (before every phase commit) | `.\scripts\verify.ps1` = the guard-rail rows in order (see testingStrategy); exits non-zero on the first failure |
| Worker logs | `docker compose logs -f worker` |
| psql | `docker compose exec db psql -U dept_migrator -d dept` |
| Prod image build check (P0 and every kernel phase) | `docker compose -f compose.prod.yaml build web worker` |

## Windows notes
- Docker Desktop with the WSL2 backend. The repo stays on `C:\Users\pc\Documents\DeptTS`; the bind mount crosses the Windows/Linux boundary, which is slow for `node_modules`/`.next` (hence named volumes) and does not propagate inotify events reliably (hence `WATCHPACK_POLLING`/`CHOKIDAR_USEPOLLING`, and `tsx watch` polls). If Turbopack HMR still misses edits, the documented fallback is `docker compose watch` with `develop.watch: [{ action: sync, path: ., target: /app, ignore: [node_modules, .next, .git] }]` replacing the bind mount for `web`; the last resort is cloning into the WSL2 filesystem and running the same commands from there.
- Git inside the container: the bind mount reports every file as mode 0777, so the image sets `core.fileMode=false` (otherwise every file shows as modified); `core.autocrlf=false` + `.gitattributes` `* text=auto eol=lf` keep LF in the repo so shell scripts, Dockerfiles and migrations run inside Linux containers. Files created by containers on the bind mount appear normally on Windows; nothing depends on ownership. Host `git status` may disagree on modes if the host has `core.fileMode=true`; set `git config core.fileMode false` on the host once (documented in README).
- Ports 3000/5432/8025/1025 must be free on the host; `docker compose ps` shows conflicts.
- No git hooks are installed; verification is explicit via `scripts/verify.ps1`.

===== workerAndJobs =====
 ## Process (`apps/worker/src/index.ts`)
```ts
import { PgBoss } from "pg-boss";
import { prismaRoot } from "@/lib/db/prisma";
import { QUEUES } from "@/platform/scheduler/queues";
import { registerHandlers } from "./registry";
import { registerSchedules } from "./schedules";
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: "pgboss", migrate: true,
                          max: Number(process.env.WORKER_CONCURRENCY ?? 4), supervise: true, schedule: true, clockMonitorIntervalSeconds: 600 });
boss.on("error", log.error);
await boss.start();
for (const q of QUEUES) if (!(await boss.getQueue(q.name))) await boss.createQueue(q.name, q.policy);
await registerHandlers(boss);   // boss.work(name, { batchSize, pollingIntervalSeconds }, handler) per queue; handler module = apps/worker/src/handlers/<queue with '.'→'-'>.ts
await registerSchedules(boss);  // boss.schedule(name, cron, data, { tz: process.env.APP_TIMEZONE })
startHeartbeat();               // touches /tmp/worker-heartbeat every 30 s (compose healthcheck) + upserts SystemSetting worker.lastHeartbeat each minute
process.on("SIGTERM", async () => { await boss.stop({ graceful: true, timeout: 30_000 }); await closeBrowser(); await prismaRoot.$disconnect(); process.exit(0); });
```
- Runs as `dept_app` (RLS enforced). Every handler payload carries `departmentId`; the handler opens `withTenantTx(departmentId, tx => ...)` from `src/lib/db/tenant.ts`. Cross-department crons list departments (global table, no RLS) and open one tenant transaction per department. `grant.reconcile` and `retention.run` use `withTenantBypass('job:<name>', ...)`, the only bypass callers besides global-admin pages.
- The worker imports platform services from `src/platform/**` directly (same package); it never imports `next` or React. Domain events, notifications, documents and workflow transitions triggered by jobs go through the same service functions the web uses, so effects (audit, outbox, ScheduledJob ledger) are identical.
- Dev: `tsx watch apps/worker/src/index.ts`; prod: esbuild bundle. Both run in the Playwright image so `playwright` + Chromium are present for PDF.
- Cron timezone is the single `APP_TIMEZONE` env value; there is no per-department cron timezone.

## Shared queue catalogue (`src/platform/scheduler/queues.ts`, used by worker AND the web send-only client)
| Queue | Policy (`createQueue`) | Handler (`apps/worker/src/handlers/`) | Idempotency / notes |
|---|---|---|---|
| `outbox.dispatch` | `short` (max one queued job), `retryLimit 3`, `expireInSeconds 60` | `outbox-dispatch.ts`: reads up to 200 `DomainEvent` rows `WHERE published_at IS NULL AND dead_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED`; for each event and each registered subscriber (`src/platform/audit/subscribers.ts`: grant sync, search index, dashboard projections, availability feeders, feature step hooks, campaign kind hooks, notification fan-out) runs the subscriber inside a tx that first `INSERT INTO event_handler_receipt(event_id, handler_key) ON CONFLICT DO NOTHING` and skips when nothing was inserted; sets `publishedAt` when all receipts exist; failed subscribers leave the event unpublished and `attempts++`, `lastError`; after 10 attempts the event gets `deadAt` and an admin notification (`system_alert`). These four columns are the only ones the `domain_event` guard trigger lets `dept_app` update | Singleton guard = queue policy `short`; the handler re-sends itself with `startAfter: 5` at the end (self-chaining) and `boss.schedule('outbox.dispatch', '* * * * *')` re-seeds the chain every minute after a worker restart (duplicate sends are dropped by the policy) |
| `reminder.materialize` | `standard`, batch 20 | `reminder-materialize.ts`: for each `ReminderSubscription` whose offsets fall inside the next 48 h: compute offsets from `resolveAnchor` or `deadlineAt`, skip past offsets, insert `ScheduledJob{idempotencyKey, kind:'reminder', runAt, status:'scheduled', pgBossJobId}` + `boss.send('reminder.fire', ..., { singletonKey: idempotencyKey, startAfter: runAt })` in one tx. **Decision:** `subscribeReminders()` (P5, `src/platform/scheduler/reminders.ts`) materialises synchronously, in the caller's transaction, every offset that falls inside the 48 h horizon at subscribe time (so tests and near deadlines need no cron), and the hourly `reminder.materialize` cron catches offsets that enter the horizon later | key `{subjectType}:{subjectId}:{scheduleKey}:{offsetDays}`; `ScheduledJob.idempotencyKey @unique` makes re-materialisation a no-op |
| `reminder.fire` | `standard`, `retryLimit 3`, `retryBackoff true` | `reminder-fire.ts`: loads `ScheduledJob` by key; exits if `status != 'scheduled'`; sets `status='running'`; checks the subject is still in the subscribed state (`WorkflowInstance.currentState in subscription.whileInStates`); resolves audience; `notify({templateKey, category, dedupeKey: key, ackRequired?})`; marks `ScheduledJob.status='sent'` (or `'cancelled'` if the state check fails) | cancel = `UPDATE scheduled_job SET status='cancelled' WHERE idempotency_key LIKE prefix` + `boss.cancel(queue, id)` |
| `notification.deliver` | `standard`, batch 50 | `notification-deliver.ts`: for each `NotificationDelivery(channel=email, status=pending)`: renders `TemplateVersion` (mustache, escaped) into `emails/Notification.tsx` (react-email) → enqueues `email.send` | `singletonKey = deliveryId` |
| `email.send` | `standard`, `retryLimit 5`, `retryDelay 30`, `retryBackoff true`, `expireInSeconds 60`, `deadLetter 'email.dead'` | `email-send.ts`: nodemailer transport from `SMTP_URL` (Mailpit in dev); sets `NotificationDelivery.status sent|failed`, `sentAt`, `lastError`, `attempts` | `email-dead.ts` → `notify` global admins (`category system_alert`) |
| `campaign.open` / `campaign.close` | `standard` | `campaign-open.ts` / `campaign-close.ts`: `Workflow.apply(instanceId, 'open'|'close', SYSTEM_ACTOR, { expectedState })` on the campaign's `FeatureRecord` workflow instance; no-op if the state moved | `singletonKey = campaign:{id}:open|close`, `startAfter = resolvedOpensAt|ClosesAt`; on `calendar.period.changed` the subscriber cancels and re-sends |
| `campaign.aggregate` | `singleton` (one active per key) | `campaign-aggregate.ts`: computes `AggregationResult` rows with k-anonymity suppression | `singletonKey = campaignId` |
| `workflow.auto_transition` | `standard`, `retryLimit 2` | `workflow-auto-transition.ts`: `{instanceId, action, expectedState}` → `Workflow.apply` with system actor (planned_activity delay, case auto-close, offering running/completed, feature step SLA, compound-state timeouts) | `singletonKey = wf:{instanceId}:{action}:{runAt}` |
| `recurrence.spawn` | `standard`, cron | `recurrence-spawn.ts`: `RecurrenceRule.nextSpawnAt <= now` → create next Task/Meeting via the service, advance `nextSpawnAt` | ledger key `recurrence:{ruleId}:{isoNextSpawnAt}` |
| `snapshot.compute` | `singleton` | `snapshot-compute.ts`: recompute `StudentCourseResult`, `CourseMetricsSnapshot` (section + offering level) and the open `CQIReport` comparison for a section offering | `singletonKey = sectionOfferingId`; payload `importBatchId`; ledger key `snapshot:{sectionOfferingId}:{importBatchId}` |
| `portfolio.provision` | `singleton` | `portfolio-provision.ts`: for each term whose `portfolio_submission` period started: create Draft `Portfolio` + `PortfolioScope` per (instructor, offering) from `TeachingAssignment` (each as a `FeatureRecord` of the seeded `portfolio` feature), create `CQIReport` with `comparisonSetJson`, subscribe deadline reminders, notify instructors | `singletonKey = provision:{termId}`; also triggered by `calendar.period.changed` |
| `report.generate` | `singleton`, `expireInSeconds 600`, `retryLimit 2` | `report-generate.ts`: `ReportDefinition.dataSourceFn(params)` → `renderReportHtml(templateKey, ctx)` → `renderPdf(html)` (below) or `exceljs-hardened` workbook / `papaparse.unparse` → `Document.storeGenerated(bytes, meta, links)` → `GeneratedReport.status='done'` → `notify` requester (`category report_ready`) | `singletonKey = report:{key}:{sha256(params)}:{format}`; present from the worker phase so committee/minutes/portfolio PDFs ship inside milestone 1 |
| `feature.migrate` | `singleton`, batch 200 records per job | `feature-migrate.ts`: `FeatureMigration{featureDefinitionId, fromVersionId, toVersionId, stateMap, stepMap, recordsTotal, recordsMigrated, recordsBlocked, blockedIds, status}`: for each `FeatureRecord` on the old `FeatureDefinitionVersion` not yet migrated, in one tx: repoint the record's version, map `WorkflowInstance.currentState`, `branchStates` and open `FeatureStepInstance`s (a record inside a `compound` state is blocked — added to `blockedIds`, `recordsBlocked++` — unless every branch is mapped), re-subscribe reminders; re-sends itself until `recordsMigrated + recordsBlocked == recordsTotal`; sets `status done|failed` | `singletonKey = migrationId`; batch ledger key `fmig:{migrationId}:{batchNo}`; resumable after restart |
| `overdue.sweep` | `standard`, cron | `overdue-sweep.ts`: tasks/feature steps with `dueAt < now` and non-terminal state and no `deadline_missed` notification → `notify(deadline_missed, dedupeKey task:{id}:missed)`, escalation per `ReminderSchedule.escalation` | dedupeKey makes reruns safe |
| `grant.reconcile` | `standard`, cron | `grant-reconcile.ts`: recompute derived `RoleGrant` rows from GroupMembership (incl. `committee_chair` for roleInGroup=chair), SectionRepresentative, TeachingAssignment, DutyAssignment; diff/insert/expire; audit summary | bypass allowed (global identity tables) |
| `calendar.autotransition` | `standard`, cron | `calendar-autotransition.ts`: catch-up for missed time-based transitions: campaigns Published with `resolvedOpensAt <= now`, In Progress past `resolvedClosesAt`, offerings Confirmed at teaching start / Running at term end, quarterly `report.generate` at quarter end | every call re-checks state; idempotent |
| `retention.run` | `standard`, cron | `retention-run.ts`: document retention classes via `document_version_purge()`, soft-delete purge after grace, `DomainEvent` published rows older than 30 d (DELETE allowed by the guard trigger only for published rows), `ScheduledJob` rows in `sent|done|cancelled` older than 90 d | — |
| `worker.heartbeat` | `short`, cron `* * * * *` | `worker-heartbeat.ts`: upserts `SystemSetting('worker.lastHeartbeat')`; `/admin/jobs` shows it | — |
| `email.dead` | `standard` | `email-dead.ts`: admin alert | — |

Cron registrations (`apps/worker/src/schedules.ts`, tz = `APP_TIMEZONE`): `outbox.dispatch * * * * *`, `reminder.materialize 0 * * * *`, `overdue.sweep 15 * * * *`, `recurrence.spawn */15 * * * *`, `calendar.autotransition */15 * * * *`, `portfolio.provision 0 2 * * *`, `grant.reconcile 0 3 * * *`, `retention.run 0 4 * * 0`, `worker.heartbeat * * * * *`. Schedules are re-asserted on every boot (`boss.schedule` upserts) and stale ones removed by comparing `boss.getSchedules()` to the list.

`ScheduledJob.status` vocabulary (JobStatus enum): `scheduled` (ledger row + pg-boss job exist) → `running` → `sent` (reminder delivered) | `done` (non-reminder job completed) | `failed` | `cancelled`.

## Enqueue from the web: decision = `fromPrisma(tx)` (transactional), outbox is NOT the job path
`src/platform/scheduler/enqueue.ts`
```ts
export function fromPrisma(tx: Prisma.TransactionClient) {
  return { executeSql: async (text: string, values: unknown[]) => ({ rows: await tx.$queryRawUnsafe(text, ...values) }) };
}
export async function enqueue(tx, name, data, opts: { singletonKey?; startAfter?; retryLimit?; idempotencyKey?; kind; subjectType?; subjectId?; departmentId }) {
  const id = await getBoss().send(name, data, { ...opts, db: fromPrisma(tx) });   // pg-boss ≥10 per-call db option
  if (opts.idempotencyKey) await tx.scheduledJob.create({ data: { idempotencyKey: opts.idempotencyKey, kind: opts.kind, queue: name, pgBossJobId: id,
      runAt: opts.startAfter ?? new Date(), status: 'scheduled', subjectType: opts.subjectType, subjectId: opts.subjectId, departmentId: opts.departmentId } });
  return id;
}
```
- `getBoss()` in the web process is a send-only singleton (`src/lib/db/boss.ts`: `new PgBoss({ connectionString: DATABASE_URL, schema: 'pgboss', supervise: false, schedule: false, migrate: false, max: 2 })`, started lazily). Because the insert runs on the Prisma transaction connection, the pg-boss job row and the ScheduledJob ledger row commit or roll back together with the workflow transition that requested them; no job can exist for a transition that was rolled back.
- The worker must have created the queues before the web sends (worker boots first in compose `depends_on`; the send-only client also runs `ensureQueues()` on start as a safety net).
- `tests/worker/enqueue-in-transaction.test.ts` proves it in the scheduler phase: a rolled-back transaction leaves no `pgboss.job` row; a committed one produces exactly one job with the expected `singletonKey`. If that test cannot be made green against pg-boss 12's `db` option, the documented contingency is `enqueue` writing a `DomainEvent(name:'job.requested')` and `outbox-dispatch.ts` calling `boss.send` — same call sites, no module changes.
- The transactional outbox (`DomainEvent` with `publishedAt`, `attempts`, `lastError`, `deadAt`) carries **domain events to subscribers** (derived grants, search, projections, availability, feature hooks); it is drained by `outbox.dispatch` with `EventHandlerReceipt` idempotency, at-least-once, ordered per aggregate by `id`.

## Idempotency keys (one vocabulary, stored in `ScheduledJob.idempotencyKey` or `Notification.dedupeKey` (required, unique))
- reminders `{subjectType}:{subjectId}:{scheduleKey}:{offsetDays}`; interval nudges `{subjectType}:{subjectId}:interval:{n}`
- notifications `{category}:{subjectType}:{subjectId}:{recipientPersonId}:{eventKey}`
- campaign `campaign:{id}:open|close|aggregate`; auto-transitions `wf:{instanceId}:{action}:{runAt}`; snapshots `snapshot:{sectionOfferingId}:{importBatchId}`; provisioning `provision:{termId}`; reports `report:{key}:{sha256(params)}:{format}`; feature migrations `fmig:{migrationId}:{batchNo}`; recurrence `recurrence:{ruleId}:{isoNextSpawnAt}`
- `Scheduler.cancel(prefix)` cancels by key prefix (ledger + `boss.cancel`), which is what `calendar.period.changed`, workflow state-exit effects and `rescheduleSubject` use.

## PDF pipeline (`apps/worker/src/pdf/browser.ts`)
One `chromium.launch()` per worker process (lazy, relaunched on crash), a new `browser.newContext()` per job, `page.setContent(html, { waitUntil: 'load' })`, `page.pdf({ format: 'A4', printBackground: true, margin: 15mm, displayHeaderFooter: true, footerTemplate: page x/y })`, concurrency limited by `p-limit(PDF_CONCURRENCY)`; the HTML comes from `src/platform/reporting/html.ts` (server-rendered React to string with print CSS, mustache only for admin-editable `document` templates such as minutes). Output bytes go through `Document.storeGenerated` → `LocalDiskProvider` (`/data/uploads/<yyyy>/<mm>/<random>.pdf`, sha256 checksum). Used by `report.generate` and by document-rendering workflow effects (minutes v1, quarterly report versions); the minutes approve effect then calls `Document.lockVersion` → `document_version_lock()`.

## Email pipeline
`notify()` (web or worker) writes `Notification` (dedupeKey unique; `ON CONFLICT DO NOTHING`) + `NotificationDelivery(in_app)` when the recipient has a User + `NotificationDelivery(email, pending)` when `ChannelPreference` allows and `Person.email` exists — in the caller's transaction — and `enqueue(tx, 'notification.deliver', { deliveryIds })`. The worker renders subject/body via `Template.render(templateKey, 'email', ctx)`, wraps it in `emails/BaseLayout.tsx` (react-email → html + text), sends with nodemailer, records status. Persons without accounts (external requesters, newly appointed representatives, students with tokens) get email only; e2e tests read Mailpit's API.

## Admin visibility (`/admin/jobs`)
Reads `ScheduledJob` (status, runAt, key, subject link), `DomainEvent` backlog (unpublished count, dead events with replay button = `deadAt := NULL, attempts := 0`), `Scheduler.dryRun(range)` (what would fire, computed from subscriptions without sending), worker heartbeat, and `pgboss.job` counts via `boss.getQueueStats()` where available.

===== testingStrategy =====
 ## Layers, runners and conventions
All test commands are `docker compose --profile test run --rm test ...` / `docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e run --rm e2e ...`. File naming: `*.test.ts(x)` for Vitest, `*.spec.ts` for Playwright. Every test lives under `tests/` (`unit`, `components`, `integration`, `worker`, `e2e`, plus `setup/` and `fixtures/`), never colocated, so the boundary lint rules and coverage globs stay simple. Env names inside tests: `DATABASE_URL`, `DATABASE_URL_MIGRATE`, `MAILPIT_URL`, `SMTP_URL`, `BASE_URL`.

`vitest.config.ts`
```ts
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    exclude: ['tests/e2e/**', 'node_modules/**'],
    coverage: { provider: 'v8', include: ['src/platform/**', 'src/lib/**', 'apps/worker/src/**'], exclude: ['src/generated/**'],
      thresholds: { lines: 80, functions: 80, branches: 70,
        'src/platform/feature/**': { lines: 90, branches: 85 }, 'src/platform/workflow/**': { lines: 90, branches: 85 },
        'src/platform/identity/**': { lines: 85 } } },
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      { extends: true, test: { name: 'components', include: ['tests/components/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['tests/setup/dom.ts'] } },
      { extends: true, test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node',
          globalSetup: ['tests/setup/global-db.ts'], setupFiles: ['tests/setup/db-each.ts'], fileParallelism: false, testTimeout: 30_000 } },
      { extends: true, test: { name: 'worker', include: ['tests/worker/**/*.test.ts'], environment: 'node',
          globalSetup: ['tests/setup/global-db.ts', 'tests/setup/global-boss.ts'], fileParallelism: false, testTimeout: 60_000 } },
    ],
  },
});
```

### 1. Unit (`tests/unit`, no DB, no Next)
Pure modules only: `workflow/machine.test.ts` (transition resolution, guards by name, `compound` states with `completion all|quorum(n)|any`, synthetic `$join`/`$reject`, `branchStates`, revision loops), `feature/validate.test.ts` (one failing fixture in `tests/fixtures/feature-definitions/invalid-*.json` per rule code of featureBuilder §4: KEY_UNIQUE, TO_RESOLVES, REACHABLE, terminal reachability, PARALLEL_BRANCHES/quorum > branches, requiredFields/requiredAttachments referencing unknown questions/slots, undeclared template variables, unknown adapter key, LOCK_VIOLATION on locked pointers, revision target not earlier, empty StepGroup, dynamic-branch group without a person source), `feature/compiler.test.ts` (snapshot of compiled WorkflowDefinition + FormDefinitions + `taskTemplates[stepKey]` + `reminderSubscriptions` for every seeded built-in — step designs per seededFeatures — and for a synthetic definition with a StepGroup inside a ParallelGroup), `feature/simulate.test.ts`, `feature/seed-hash.test.ts` (locked paths vs `seed:<hash>` baseline), `forms/zod-from-fields.test.ts`, `scheduler/offsets.test.ts` (materialisation, skipped past offsets, anchor edges, 48 h horizon), `template/mustache-safe.test.ts` (escaping per channel, unknown-variable rejection), `import/validators/*.test.ts` (unknown/duplicate IDs, out-of-range, missing components, fuzzy name warnings), `metrics/{grades,cqi,borda,k-anonymity}.test.ts`, `availability/overlap.test.ts`, `identity/levels.test.ts` (`can()` with an in-memory grant set and stubbed SubjectRegistry; `PermissionLevel.none`). Every service phase adds at least one file.

### 2. Components (`tests/components`, jsdom + Testing Library)
`FormRenderer` per question type (likert, ranked_list, repeating_group, file slot), `StepTimeline`/`ParallelLanes` rendering of a compiled definition, builder wizard step forms (react-hook-form + Zod resolver errors), `DataTable` column generation from a list spec. Async Server Components are not rendered here (Playwright covers them).

### 3. Integration (`tests/integration`, real Postgres, RLS on)
- **Per-run schema**: `tests/setup/global-db.ts` generates `it_<8hex>`, connects as `dept_migrator` to `dept_test`, runs `CREATE SCHEMA it_x; GRANT USAGE ON SCHEMA it_x TO dept_app; ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA it_x GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dept_app; ... USAGE, SELECT ON SEQUENCES ...; ... EXECUTE ON FUNCTIONS ...`, then `execFileSync('npx', ['prisma','migrate','deploy'], { env: { DATABASE_URL_MIGRATE: `${base}?schema=it_x` } })` (this is how the `<ts>_append_only` and `<ts>_document_locks` REVOKEs and SECURITY DEFINER functions land after the grants, inside the run schema), runs `seedMinimal()` once, `provide('testSchema', name)`; teardown drops the schema unless `KEEP_TEST_SCHEMA=1`.
- **Clients**: `tests/setup/db.ts` exposes `migratorDb` (dept_migrator, bypasses RLS: used for assertions such as "row exists in dept B") and `appDb` (dept_app, `PrismaPg({...}, { schema })` = the same construction as `prismaRoot`), plus `withDept(deptId, fn)` = `withTenantTx`. `tests/setup/db-each.ts` truncates all non-seed tables (`truncate.ts` builds the list from DMMF `dbName`s minus roles/permissions/settings/templates/forms/workflows/feature definitions) in `beforeEach` at file level via `migratorDb`, re-running `seedMinimal()` parts that were truncated (two departments `CS` and `EE` created through the better-auth organization API so `Department.id === organization.id`, one academic year/term with periods, one user per role per department with `Person.userId` + `DepartmentPerson` rows, permission matrix).
- **Factories** (`tests/setup/factories.ts`): `person()`, `departmentPerson(dept, personId)`, `staff()`, `student()`, `userWithRole(dept, roleKey)`, `committee(dept, {chair, members})` (chair produces a derived `committee_chair` RoleGrant, never a Member role), `courseOffering(dept, term)`, `sectionOffering()`, `teaching()`, `enrollment()`, `task(dept, spec)`, `formDefinition()`, `campaign(kind)`, `featureDefinition(overrides)` (featureBuilder §1 shape), `document()`; every factory takes `departmentId` first, returns ids, and writes through the real service API (not raw inserts) except where the test needs a corrupt state.
- **Suites**: `tenancy/rls-isolation.test.ts` (dept A client: `findMany` on every tenant model returns only A rows, nested `include` across tenants returns nothing, `$queryRaw` returns 0 B rows, `update`/`delete` of a B row affects 0 rows, a connection without the setting sees 0 rows, `withTenantBypass` sees both and writes an audit row); `tenancy/rls-coverage.test.ts` (every DMMF model with a `departmentId` field has `relrowsecurity && relforcerowsecurity` and a policy in `pg_policies` for its `dbName`; every model without it is in the allow-list of global tables incl. Person, DepartmentPerson, auth tables); `tenancy/append-only.test.ts` (UPDATE/DELETE on audit_event and workflow_transition_log raise as dept_app; UPDATE of `domain_event.payload` raises while UPDATE of `published_at` succeeds; direct UPDATE of document_version raises while `document_version_lock()` succeeds); `identity/*` (better-auth `createUser` + membership + `setActive`, `can()` matrix incl. derived grants and DPT exclusions, reconcile diff); `workflow/*` (apply with guards/effects, rollback on effect failure, concurrent branch completions with `SELECT ... FOR UPDATE` proven via two parallel transactions); `feature/{runtime,versioning,migration,seed}.test.ts` (create → step → compound → quorum join → terminal with Tasks (`TaskKind.feature_step`), ReminderSubscriptions, Notifications asserted; publish creates a new `FeatureDefinitionVersion` and pins records; `FeatureMigration` preview counts (`recordsBlocked`, `blockedIds`) and batched apply; every seeded feature compiles and its locked paths reference registered `AdapterRegistration` rows; seed hash unchanged); `scheduler/*` (ledger idempotency, cancel-by-prefix, calendar re-anchoring, dryRun, synchronous materialisation inside the horizon); `notification/*` (dedupe, ack/decline, deliveries for persons without users); `document/*` (upload to LocalDisk under `/tmp/uploads`, inherited access, version lock via SECURITY DEFINER); `import/*` (replace semantics per batch, section lock guard); `campaign/*` (publish/open/close/aggregate, anonymity: no FK path, trigger rejects respondent on anonymous, adversarial join query returns nothing); `availability/*` (EXCLUDE constraint rejects overlapping hard blocks for a person and a resource, soft blocks allowed, `blackout` kind); `search/*`.

### 4. Worker (`tests/worker`, real pg-boss)
`tests/setup/global-boss.ts` starts `new PgBoss({ connectionString: DATABASE_URL, schema: 'pgboss_it_<runid>', migrate: true })` as `dept_app` (allowed by `GRANT CREATE ON DATABASE dept_test TO dept_app` in init.sql), creates queues from the shared catalogue, registers the real handlers from `apps/worker/src/registry.ts` with `pollingIntervalSeconds: 0.5`; tests enqueue through `enqueue(tx, ...)` from a Prisma transaction and await completion by polling `boss.getJobById(name, id)` until `completed|failed` (helper `awaitJob`). Suites: `enqueue-in-transaction`, `outbox-dispatch` (receipt idempotency, dead events, self-chaining), `reminders` (materialize → fire → notification once even when materialized twice; cancelled key does not fire; status ends `sent`), `campaign-open-close`, `auto-transition` (expectedState mismatch is a no-op), `snapshot-compute`, `report-pdf` (bytes start with `%PDF-`, `pdf-parse` finds the committee name), `feature-migrate` (resumes after a simulated crash; blocked records reported), `email` (Mailpit receives one message per delivery via `MAILPIT_URL`; retry on transport error). Teardown `boss.clearStorage()` and drops the pgboss test schema.

### 5. E2E (`tests/e2e`, Playwright 1.63, Chromium, against `next build && next start` on `dept_e2e`)
- `playwright.config.ts`: `testDir: 'tests/e2e'`, `outputDir: 'tests/e2e/.results'`, `baseURL: process.env.BASE_URL`, `fullyParallel: false`, `workers: 2`, `retries: process.env.CI ? 1 : 0`, `reporter: [['list'], ['html', { outputFolder: 'tests/e2e/.results/html', open: 'never' }]]`, `use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }`, projects `setup` (global login) and `chromium` (`dependencies: ['setup']`), no `webServer`.
- `tests/e2e/global-setup.ts`: runs `tests/setup/reset-e2e.ts` in-process (truncate + `prisma db seed` with `SEED_DEMO=1` via `DATABASE_URL_MIGRATE`), `DELETE {MAILPIT_URL}/api/v1/messages`, then logs in each seeded user (`admin@deptts.local`, `dh.cs@`, `dpt.cs@`, `instructor1.cs@`, `chair.cs@`, `rep.cs@`, `dh.ee@` — password `Passw0rd!dev`) through the UI and saves `tests/e2e/.auth/<role>.json`; `fixtures/auth.ts` gives `test.use({ storageState })` per role and a `loginAs` helper.
- `fixtures/mailpit.ts`: `waitForMail({ to, subjectIncludes, timeoutMs })` polls `GET {MAILPIT_URL}/api/v1/search?query=to:"<email>"` then `GET /api/v1/message/<ID>` and returns `{ subject, text, html, links[] }`; used for set-password/reset links, campaign invitations (`/c/[token]`), appointment confirmations (`/a/[hostSlug]`) and reminder mails (the worker runs against `dept_e2e` in the override).
- One journey spec per phase (login and department switch via `/select-department`; admin creates user via set-password mail; task assign → ack in inbox → deliverable upload through `/api/uploads` → submit → review → complete; builder wizard creates a feature with a parallel review group, simulate, publish, run it as DH and two reviewers, dashboard counter updates; committee report submit/approve + PDF download from `/api/documents/[id]/v/[versionNo]/download` starts with `%PDF`; assessment upload with validation errors then commit; portfolio provision/submit/approve locks the section; add/drop campaign via token link; evaluation anonymity (results page shows suppressed cells under k); meeting minutes approve locks the version; appointment booking through the public link; case escalation from a thread). Assertions prefer `getByRole`/`getByLabel`; tenancy check: `dh.ee` cannot open a CS record URL under `/d/cs/...` (404).

### Guard rails run by `scripts/verify.ps1` before every phase commit
1. `docker compose run --rm web sh -c "npx prisma validate && npm run schema:check && npx next typegen && npx tsc --noEmit && npx eslint . && npm run rls:check"`
2. `docker compose --profile test run --rm test npx vitest run --project unit --project components`
3. `docker compose --profile test run --rm test npx vitest run --project integration --project worker --coverage` (coverage thresholds fail the run)
4. `docker compose -f compose.yaml -f compose.e2e.yaml up -d --wait web worker` then `docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e run --rm e2e npx playwright test` then `docker compose -f compose.yaml -f compose.e2e.yaml down`
5. `docker compose -f compose.prod.yaml build web worker` (kernel phases only; proves the standalone and worker images still build)
The phase is committed (`docker compose run --rm web git add -A && docker compose run --rm web git commit -m "..."`) only when all five exit 0.

===== ASSUMPTIONS =====
- Faculty is a single global row; each Department is a better-auth Organization and Department.id is set equal to Organization.id (text id) so session.activeOrganizationId is the departmentId without a lookup; departments are therefore seeded through the better-auth organization API; a user may be a member of several departments with a different membership role in each; the global admin (admin plugin user.role='admin') belongs to none by default and picks a department to act in.
- Person is faculty-global (one directory, linked to a login only through Person.userId @unique; no user.personId additional field) with DepartmentPerson rows linking a person to each department; StaffProfile, Student and every operational record are department-scoped and RLS-protected; shared definitions (workflow, form, template, reminder schedule, feature, role) use a nullable departmentId where NULL rows are faculty-wide seeds that a department may fork.
- Ids are text cuid() everywhere (better-auth tables keep the ids better-auth generates); RLS policies compare department_id to current_setting('app.current_department_id', true) as text with no cast; every model and column is @@map/@map'ed to snake_case and all hand-written SQL uses snake_case identifiers.
- committee_chair (like committee_member, student_rep, instructor@section_offering, lab_staff) is a scoped, derived RoleGrant, never a better-auth membership role; better-auth Member.role carries only the coarse department membership role and every authorization decision goes through can().
- Students beyond representatives do not get accounts in milestone 1; they participate through hashed invitation tokens (/c/[token]) and public request links (/a/[hostSlug]) delivered by email (Person.email required for students); representatives are auto-invited (set-password mail) when assigned.
- A course portfolio is one per (instructor, course offering) covering all their sections (PortfolioScope rows); attendance is captured as aggregate questions in the portfolio narrative by default, with per-student import behind SystemSetting attendanceCaptureMode.
- DPT defaults to the DH permission set minus the SystemSetting dpt.excludedPermissions list (portfolio.approve, evaluation.close, evaluation.analyze, plan.approve, minutes.approve); k-anonymity threshold default 5.
- Timezone for cron schedules, reminders and date rendering is the single APP_TIMEZONE environment value (default Africa/Addis_Ababa in .env.example, to be confirmed with the user before the scheduler phase); there is no per-department cron timezone; calendar is Gregorian only.
- pg-boss 12 exposes the per-call db option on send/insert (introduced in v10) so jobs can be inserted on the Prisma transaction connection; the scheduler phase proves it with tests/worker/enqueue-in-transaction.test.ts and the outbox-based contingency is documented if it fails.
- Reminder offsets inside a 48-hour horizon are materialised synchronously by subscribeReminders() in the caller's transaction; the hourly reminder.materialize cron only catches offsets that enter the horizon later.
- Development runs on Docker Desktop for Windows (WSL2 backend) from the Windows filesystem with polling watchers; every Node command and every writing git command (init, add, commit, tag) runs inside the web container (git is installed in the web dev image with safe.directory /app, core.fileMode=false); host git is used only for push/pull/fetch and read-only status; the host Node 20 is never used; production images are built from the same Dockerfiles.
- The worker image is the Playwright image (Node 22 + Chromium) so the job runner and PDF rendering share one container; the web image never contains Chromium; the test and e2e services reuse that image so PDF handler tests and Playwright specs run without extra installs.
- Postgres roles exist only in docker/postgres/init.sql: dept_migrator (LOGIN, CREATEDB, BYPASSRLS, owner of dept/dept_test/dept_e2e) and dept_app (LOGIN, NOBYPASSRLS, owner of the pgboss schema); migrations never create roles or the pgboss schema; the worker, web and integration tests run as dept_app, so append-only guarantees that the worker must bypass (DomainEvent bookkeeping, DocumentVersion locking/purge) are implemented as column-guard triggers and SECURITY DEFINER functions rather than REVOKEs.
- Prisma CLI and client are pinned exactly to 7.10.0 (.npmrc save-exact) because npm latest is the 8.0 release candidate; migrations use Prisma's timestamped folder names and are described by phase, not by fixed numbers; better-auth's auth.prisma is always regenerated by `npx auth@latest generate` inside the container, never hand-edited.
- Later-milestone modules (annual plan/quarterly, invigilation, labs, resources, staff reports, load export, student communication) are added as further seeded feature definitions plus module tables in their own schema files (planning/load/scheduling/resource.prisma) using the same builder, runtime, worker queues and test layers; a real load-assigner sample file is expected before the load phase and a golden fixture stands in until then.

===== RISKS =====
- RLS policy list drifts from the Prisma schema as tenant models are added across phases, leaving a table without FORCE ROW LEVEL SECURITY, or a hand-written policy names a camelCase column that does not exist in the snake_case table.
    -> prisma/scripts/gen-rls.ts generates the policy SQL from the DMMF using dbName for tables and columns and maintains prisma/rls-manifest.json; `npm run rls:check` and `npm run schema:check` (both in verify) fail when a departmentId model is missing from the manifest or a model/column lacks its snake_case @map; tests/integration/tenancy/rls-coverage.test.ts fails against the live schema when any such table lacks relforcerowsecurity or a policy; new tenant tables are always created with `migrate dev --create-only` plus `gen-rls.ts --append` in a `<ts>_rls_p<N>` migration.
- The Prisma query extension plus transaction-local set_config adds latency per request and complicates nested interactive transactions.
    -> One withTenantTx per server action or job (set_config once at transaction start, request-scoped via React cache() in getDb()); the forDepartment extension only injects departmentId as a safety net; PrismaPg pool sized per container (PG_POOL_MAX); tests/integration/tenancy/rls-explain.test.ts asserts index usage on departmentId-first indexes and a dashboard-query benchmark guards regressions.
- pg-boss enqueue on the Prisma transaction connection (fromPrisma) behaves differently from pg-boss's own pool (placeholder or jsonb marshalling through $queryRawUnsafe).
    -> tests/worker/enqueue-in-transaction.test.ts proves commit/rollback semantics in the scheduler phase before any module depends on it; the send-only client and the worker share one queue catalogue; documented contingency switches enqueue() to a DomainEvent that outbox-dispatch.ts turns into boss.send without touching call sites.
- Append-only protections block the worker itself (it runs as dept_app) from marking outbox events published or locking document versions, or the per-run test schema loses the dept_app grants the app relies on.
    -> domain_event is never REVOKE'd; a column-guard trigger permits dept_app to change only published_at, attempts, last_error, dead_at and to delete published rows; document_version updates go through SECURITY DEFINER document_version_lock()/document_version_purge() owned by dept_migrator; functions and triggers are created unqualified so `migrate deploy` with `?schema=it_x` lands them in the run schema after the default privileges are set; tests/integration/tenancy/append-only.test.ts asserts both the denial and the permitted paths as dept_app.
- Outbox dispatch duplicates side effects (at-least-once) or stalls after a worker restart.
    -> Every subscriber runs inside a transaction that first inserts EventHandlerReceipt(eventId, handlerKey) and skips on conflict; the outbox.dispatch queue uses policy short plus self-chaining and a one-minute cron re-seed, so exactly one dispatcher chain exists; dead events after 10 attempts raise an admin alert and can be replayed from /admin/jobs.
- Compound (parallel) states and quorum joins create inconsistent workflow state under concurrent actions or during feature version migration.
    -> Workflow.apply runs in one transaction with SELECT ... FOR UPDATE on WorkflowInstance and the FeatureStepInstance rows; join counts are re-evaluated inside the lock against branchStates; the pure machine in src/platform/workflow/machine.ts is exhaustively unit-tested against the single State/Transition JSON contract before any UI; feature.migrate blocks records inside a compound state unless every branch is mapped, records recordsBlocked/blockedIds in FeatureMigration and resumes after a crash.
- Admin edits to seeded features break code-backed modules (renamed question keys, removed states used by adapters).
    -> lockedPaths per seeded definition compared with the seed hash baseline (FeatureDefinitionVersion.changeNote 'seed:<hash>'), LOCK_VIOLATION from validateDefinition at publish, compiler check that every adapter/guard key exists in AdapterRegistration, simulate dry-run before publish, records pin versions, tests/integration/feature/seed.test.ts compiles every seed on each verify run.
- Windows bind mounts make Turbopack dev slow, miss file changes inside the container, or make git-in-container report spurious mode changes.
    -> node_modules, .next, uploads and pgdata are named volumes; polling watcher variables are set; LF line endings are enforced by .gitattributes; the web image sets core.fileMode=false, core.autocrlf=false and safe.directory /app so `docker compose run --rm web git ...` behaves; the README documents the two fallbacks in order: `docker compose watch` sync mode replacing the bind mount for web, then cloning the repo into the WSL2 filesystem and running the identical compose commands there.
- Playwright Chromium PDF rendering in the worker is memory-heavy or flaky under load.
    -> One browser per worker process with a new context per job, p-limit(PDF_CONCURRENCY=2), singleton report jobs with expireInSeconds 600 and retryLimit 2, `init: true` and `ipc: host` on the worker container, worker healthcheck restarts a wedged process, tests assert the %PDF header and extracted text rather than pixel output.
- Anonymous evaluation responses are de-anonymisable through joins, timestamps or small cohorts.
    -> No foreign key from Submission to CampaignInvitation, trigger enforces NULL respondent/invitation on anonymous campaigns, invitation marked submitted in a separate statement, day-truncated submittedAt, coarse cohort attributes, k-anonymity suppression in AggregationResult, actor-less audit rows, and an adversarial integration query suite that must return zero linkable rows before the evaluation phase closes.
- pg-boss and Prisma migrations interfere in the same database, or worker tests cannot create their per-run pgboss schema.
    -> pg-boss owns schema pgboss exclusively (created in init.sql owned by dept_app, migrated by pg-boss); Prisma never declares it and DATABASE_URL search_path stays public; dept_test grants CREATE to dept_app so tests/setup/global-boss.ts can create pgboss_it_<runid>; teardown drops it.
- better-auth 1.7.5 generated schema or plugin behaviour differs slightly from the documented one (organization roles, admin plugin fields).
    -> auth.prisma is always produced by `npx auth@latest generate` inside the container and committed; application code depends only on plugin APIs and Prisma types; better-auth roles carry coarse membership only while every authorization decision goes through can() with RolePermission/RoleGrant (including the derived committee_chair grant), tested against the seeded matrix.
- E2E runs on Windows are slow (production build per run) or flaky (timing on emails and jobs), discouraging developers from running them before commits.
    -> compose.e2e.yaml keeps a dedicated next_e2e volume so rebuilds are incremental and never collide with the dev .next; the worker runs against dept_e2e so jobs are real; Mailpit polling helper with timeouts; retries: 1 in CI mode; trace and screenshot on failure in tests/e2e/.results; each phase adds exactly one journey spec so the suite grows linearly.
- The generic feature runtime becomes an inner platform that is slower to build than the modules it replaces, or built-in modules grow a parallel code path for special UI.
    -> The runtime is proven on the seeded task feature before any module; every step is a Task row (TaskKind.feature_step) and every step page is the generic StepPage; modules only register surfaces[featureKey] = { detailExtras, stepRenderers, listExtras } and adapters from the registry; no admin-defined free-form tables or scripting; the builder scope is fixed to process features.
- Cron timezone or calendar period edits cause reminders to fire late, twice or against stale dates.
    -> APP_TIMEZONE is a single explicit setting used by boss.schedule and date rendering; anchored ReminderSubscriptions are re-resolved on calendar.period.changed with cancel-by-prefix and re-materialisation; ScheduledJob idempotency keys make re-materialisation a no-op (synchronous at subscribe time inside the 48 h horizon, hourly cron beyond it); admin impact preview and Scheduler.dryRun; worker tests cover duplicate materialisation and cancelled keys.
- Naming drift between parts (compose services, env variables, db helper names, route paths, test directories) leads phases to reference files or services that do not exist.
    -> This part fixes the canonical names in one table (prismaRoot / forDepartment / getDb / withTenantTx / withTenantBypass / requireContext / requireDeptContext / requireAdmin / requireCan; compose services web, worker, db, mailpit, test, e2e; env BASE_URL, MAILPIT_URL, SMTP_URL, DATABASE_URL, DATABASE_URL_MIGRATE; tests/{unit,components,integration,worker,e2e}; routes /c/[token], /a/[hostSlug], /api/uploads, /api/documents/[id]/v/[versionNo]/download, /d/[dept]); every phase's verifyCommands and keyFiles are rewritten to these names and ESLint import boundaries plus `tsc --noEmit` over src, apps/worker and tests catch a stale import at the first verify run.
