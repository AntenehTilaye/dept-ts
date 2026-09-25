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

A task is a record of the `task` feature — there is one task lifecycle, wherever the task came from, and it is the compiled `feature:task` machine on the record. One `Task` table still carries every task-like thing (`src/platform/workitem`) and has no status column: `task_backing_check` says a row is a record's (`feature_record_id`), a step's companion (`feature_step_instance_id`) or a recurrence template (`recurrence_rule_id`), and nothing else. Acknowledgement is the assignment `Notification`, deliverables are `DocumentLink(deliverable, slotKey)` rows gating the submit transition, audiences are snapshotted into ad-hoc groups at assignment time, and overdue is always computed. `/d/[dept]/my-work` is the personal queue; `/d/[dept]/tasks` and `/d/[dept]/tasks/[recordId]` are readable rewrites onto the generic runtime (`next.config.ts`), so notifications and the SubjectRegistry keep handing out the URLs people know. Work spawned by something else — a transition that asks for a follow-up, a `RecurrenceRule` the `recurrence.spawn` cron rolls forward — goes through `createTaskRecord`, so it arrives as a record like any other. A module adds what the generic page cannot know through a surface (`src/modules/surfaces.ts`): the task surface contributes the deliverable slots and the acknowledgement list.

Upgrading a database that still holds P7 tasks: run `docker compose run --rm web npx tsx prisma/scripts/backfill-task-feature-records.ts` (idempotent) **before** `prisma migrate deploy` applies `constraints_p9b` — a CHECK constraint cannot be deferred, so every task needs its record first.

## Reports

One rendering path for every report (`src/platform/reporting`). A report is a registration — who may run it, what it asks for, where its rows come from — and the framework turns those rows into a readable page, a workbook with typed columns, a csv with a BOM, or an A4 PDF. `department_activity`, `task_list` and `audit_extract` ship with it, one per format worth proving.

HTML and CSV are rendered in the request; a PDF needs a browser and a workbook can be large, so both are a `report.generate` job, deduplicated on the report, its parameters and the format. The worker keeps one Chromium per process, relaunches it if it dies and limits concurrent renders (`PDF_CONCURRENCY`); a failure is written onto the run so the page can say what went wrong rather than spinning. Whatever the format, the output is stored through the document service with a `generated_output` link, so downloads are the same audited, signed, five-minute links as every other file. `/d/[dept]/reports` lists what the reader may run and what has been generated lately. `ExportFormatSpec` (a versioned description of a file another system expects, with a golden sample to diff against) is in place for the load phase.

## Importing spreadsheets

Every spreadsheet a department is sent goes through one staged pipeline (`src/platform/import`), because the hard parts are the same each time: read the file, work out which column is which, say exactly what is wrong with which row, let somebody fix it, and only then write. A batch is a record of the seeded `import_batch` feature, so the staging IS a workflow — `uploaded` → `parsed` → `validated` → committed, with `discarded` as the way out — and the pipeline supplies only the work each state does. `/d/[dept]/imports` is the readable URL of the generic runtime, and a section card links straight into a roster import of that section.

A kind of file is a preset (`roster` and `class_timetable` in this phase; assessment and attendance arrive with the portfolio phase as a seed upgrade) plus two registrations: a **validator**, which sees every row at once so a duplicate can be seen at all and answers per row, and a **committer**, which runs inside the commit transaction with rows a validator already understood — so it writes rather than interprets, and either the whole file lands or none of it does. Column matching ignores case, spaces and punctuation, a saved `ColumnMappingProfile` beats every guess, and a required column nothing claimed is a batch-level error rather than a hundred row-level ones. A row is corrected in the preview, not in the spreadsheet, and correcting it re-checks the file. Committing marks the previous batch of the same context replaced and publishes `import.committed`; committing a timetable writes the slots, which is what makes the instructor and the room busy in the availability ledger. A file over a megabyte is read by the worker (`import.parse`, `import.validate`) instead of inside the request.

## Availability

One busy-time ledger for the department (`src/platform/availability`). Whatever takes a person's or a room's time — a class, a lab, an exam, an invigilation duty, a meeting, an appointment, leave — is an `AvailabilityBlock` owned by that person or resource and written by the module that owns the source, never by hand: `registerBlocks(source, blocks)` replaces everything that source wrote before, so recommitting a timetable cannot leave yesterday's rows behind. `no_hard_overlap` (an `EXCLUDE USING gist` over owner and time) makes a double booking impossible rather than merely unlikely, and `registerBlocks` refuses one first with `HardConflictError` naming what it collided with. A weekly class is one template row carrying its weekday and the term it repeats in; `materialiseRecurring(termId)` writes the concrete weeks, which is when they join the constraint.

An `AvailabilityPolicy` is what somebody offers for a purpose (appointments, invigilation, leave): weekly windows in the department's own clock, breaks inside them, days away, a slot length and a daily maximum. The days away become hard blocks, so everybody else's scheduling respects them without knowing what a policy is. `checkConflicts` answers "is this person or this room free then, and if not, why not?" (hard overlap, soft overlap, outside the declared windows, over the daily maximum), `freeSlots` is the windows minus the breaks minus the ledger cut into slots, `workload` totals the hours a term holds and `suggestAssignees` ranks a pool — free first, then least inconvenienced, then least loaded. Both computations are registered as the locked adapters `availability.checkConflicts` and `availability.suggestAssignees`, which is how a schedule feature asks; the workflow effects `registerBlocks` and `removeBlocks` are the generic door for a definition that books time. `/d/[dept]/availability` is where a person declares their own, sees what is already booked for them this week and what that leaves free.

## Documents and discussions

Files live only in the document service (`src/platform/document`): `POST /api/uploads` (multipart, size cap from `upload.maxBytes`, magic-byte and CSV checks, links validated through the SubjectRegistry) stores immutable versions on the `StorageProvider` (local disk under `UPLOAD_DIR`, keys `yyyy/mm/<random>`), downloads go through 5-minute signed links bound to the user (`/api/documents/[id]/v/[n]/download`, audited), approving transitions lock versions through `document_version_lock()`, and the weekly retention job purges soft-deleted documents after `document.retentionDays`. Threads and comments (`src/platform/thread`) carry `@[Name](person:id)` mentions that notify through the `mention` template; escalation to a case is a registered seam filled by the feature runtime. Any record page hosts `SubjectDocuments` and `SubjectThread`.

## Forms and campaigns

Questions are data, never code: a `FormDefinition` is a versioned set of `Question` rows described by the `FieldDef` contract (`src/platform/forms/field-schema.ts`), the validation schema is generated from it (`zodFromFields`), and `FormRenderer` renders every type — text, number, date, boolean, choices, likert and scale, the pickers, ranked lists, repeating groups, conditional questions. A new version is cut only when the question hash changes, and a system form's locked questions can neither disappear nor change type, so answers stay readable. Answers are normalised into `Answer` rows with typed columns (`numericValue`, `rank`, `refType`/`refId`, `textValue`), which is what makes aggregation possible without reading JSON.

A campaign (`src/platform/campaign`) is a windowed run of a form over an audience: publishing resolves the audience into `CampaignInvitation` rows and schedules `campaign.open`/`campaign.close`; opening mints a 256-bit token per invitation, stores only its sha256 and mails the `/c/<token>` link; closing expires the tokens and enqueues `campaign.aggregate`. Anonymity is structural rather than promised — the database refuses a respondent or an invitation on an anonymous submission, truncates its timestamp to the day, and the audit row names no actor — and results below `SystemSetting campaign.kThreshold` (default 5) are suppressed, with free text never released for an anonymous campaign. `/c/[token]` is the one route without a session (rate limited per address), `/d/[dept]/campaigns/[id]/results` shows participation, the cells and a csv export stored as a document, and `/admin/forms` edits definitions as JSON with a live preview until the feature wizard replaces it.

## Worker and jobs

The `worker` service owns the `pgboss` schema, creates every queue of `src/platform/scheduler/queues.ts` at boot and registers the crons (`APP_TIMEZONE`, default `Africa/Addis_Ababa`). The web process only sends jobs, always on the caller's Prisma transaction (`enqueue(tx, ...)`) so a rolled-back action leaves no job behind; `/admin/jobs` shows the ledger, the outbox backlog and the worker heartbeat, `/admin/reminders` the schedules and a dry run, `/admin/templates` the versioned mustache templates.
