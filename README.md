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

## Git workflow

Work happens on branches (`feat/p<N>-<topic>`, `fix/<topic>`), one verified phase per branch, merged into `main` through a pull request. `.github/workflows/ci.yml` mirrors the verification sequence but is manual-only (`workflow_dispatch`) until CI is switched on.

## User interface

Screens are built from official [shadcn/ui](https://ui.shadcn.com) components (`npx shadcn@latest add <name>` inside the `web` container; `components.json` holds the style) and the pattern layer under `src/components/patterns` (`PageHeader`, `DataTable`, `EmptyState`, `StatCard`, `FormSection`, `ListLayout`, `SegmentedLinks`, `PageSkeleton`). The researched standard every page follows is `docs/design/08-ui-standard.md`. The Playwright container can also drive the dev server (`docker compose up -d web` then `docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e run --rm --no-deps e2e npx playwright test <spec>`), which is where hydration problems surface with full React messages.

## Features: processes as data

A process is not a folder of pages. An administrator composes a **FeatureDefinition** — navigation, scope, parent, record fields, a tree of steps with their forms, assignees, actions, deadlines, reminders and notifications, terminal states, list views and counters — and publishing compiles it (`src/platform/feature/compile.ts`) into the artefacts the other kernels already run: one `WorkflowDefinition` (a state per step, one compound state per parallel group with its branches and the synthetic join and reject transitions), a `FormDefinition` per step, a task template per leaf, reminder subscriptions and permission rows. The compiler is pure, so the same definition always produces the same artefacts and can be snapshot-tested and simulated.

Running one is the generic runtime (`src/platform/feature/runtime`, pages under `/d/[dept]/f/[featureKey]`): `createRecord` validates the header, numbers it `F-<prefix>-<year>-<seq>` from the department's sequence, creates the backing row and enters the first step; entering a step resolves its assignee, creates the task, computes the deadline, subscribes the reminders and sends the notifications; `act()` is the only path into `Workflow.apply`, and the compiled `feature.*` effects are what move the record. Every column on `FeatureRecord` that looks like state — `currentStateKey`, `branchStatesCache`, `deadlineAt`, `closedAt` — is a cache those effects write.

`task`, `case` and `generic_request` are seeded as system features (`prisma/seed/features`). The seed owns only the **locked** pointers — the backing, adapters, guards, effects, computed fields, source bindings, surfaces and automatic triggers, derived from the document itself — so an administrator may rename a step or add a notification and a release may change the code-backed parts, without either overwriting the other: a changed locked hash leaves a merged `seed-upgrade:` draft and `/admin/features` says "system update pending". Records pin the version they were created on; moving them is a separate migration with a state map the administrator writes, run in batches by the `feature.migrate` worker, and a state with no home blocks its records rather than guessing.

## Work items

One `Task` table carries every task-like thing (`src/platform/workitem`): no status column — the lifecycle is the `WorkflowInstance` whose subject is the task (`src/platform/workflow/definitions/task.ts`, the single hand-written definition, retired once the feature builder compiles `feature:task`) — acknowledgement is the assignment `Notification`, deliverables are `DocumentLink(deliverable, slotKey)` rows gating the submit transition, audiences are snapshotted into ad-hoc groups at assignment time, and overdue is always computed. `/d/[dept]/my-work` is the personal queue, `/d/[dept]/tasks` the department list, and `/d/[dept]/tasks/[taskId]` the record page built from the shared `RecordDetail` shell that the feature runtime will reuse. Repeating work is a `RecurrenceRule` spawned by the `recurrence.spawn` cron.

## Documents and discussions

Files live only in the document service (`src/platform/document`): `POST /api/uploads` (multipart, size cap from `upload.maxBytes`, magic-byte and CSV checks, links validated through the SubjectRegistry) stores immutable versions on the `StorageProvider` (local disk under `UPLOAD_DIR`, keys `yyyy/mm/<random>`), downloads go through 5-minute signed links bound to the user (`/api/documents/[id]/v/[n]/download`, audited), approving transitions lock versions through `document_version_lock()`, and the weekly retention job purges soft-deleted documents after `document.retentionDays`. Threads and comments (`src/platform/thread`) carry `@[Name](person:id)` mentions that notify through the `mention` template; escalation to a case is a registered seam filled by the feature runtime. Any record page hosts `SubjectDocuments` and `SubjectThread`.

## Forms and campaigns

Questions are data, never code: a `FormDefinition` is a versioned set of `Question` rows described by the `FieldDef` contract (`src/platform/forms/field-schema.ts`), the validation schema is generated from it (`zodFromFields`), and `FormRenderer` renders every type — text, number, date, boolean, choices, likert and scale, the pickers, ranked lists, repeating groups, conditional questions. A new version is cut only when the question hash changes, and a system form's locked questions can neither disappear nor change type, so answers stay readable. Answers are normalised into `Answer` rows with typed columns (`numericValue`, `rank`, `refType`/`refId`, `textValue`), which is what makes aggregation possible without reading JSON.

A campaign (`src/platform/campaign`) is a windowed run of a form over an audience: publishing resolves the audience into `CampaignInvitation` rows and schedules `campaign.open`/`campaign.close`; opening mints a 256-bit token per invitation, stores only its sha256 and mails the `/c/<token>` link; closing expires the tokens and enqueues `campaign.aggregate`. Anonymity is structural rather than promised — the database refuses a respondent or an invitation on an anonymous submission, truncates its timestamp to the day, and the audit row names no actor — and results below `SystemSetting campaign.kThreshold` (default 5) are suppressed, with free text never released for an anonymous campaign. `/c/[token]` is the one route without a session (rate limited per address), `/d/[dept]/campaigns/[id]/results` shows participation, the cells and a csv export stored as a document, and `/admin/forms` edits definitions as JSON with a live preview until the feature wizard replaces it.

## Worker and jobs

The `worker` service owns the `pgboss` schema, creates every queue of `src/platform/scheduler/queues.ts` at boot and registers the crons (`APP_TIMEZONE`, default `Africa/Addis_Ababa`). The web process only sends jobs, always on the caller's Prisma transaction (`enqueue(tx, ...)`) so a rolled-back action leaves no job behind; `/admin/jobs` shows the ledger, the outbox backlog and the worker heartbeat, `/admin/reminders` the schedules and a dry run, `/admin/templates` the versioned mustache templates.
