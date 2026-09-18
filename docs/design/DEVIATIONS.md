# Deviations from the design documents

The code is authoritative; this file records where and why it departs from `03`–`07`.

| Phase | Design said | Implementation | Why |
| --- | --- | --- | --- |
| P0 | `eslint@10` | `eslint@9.39.5` | `eslint-config-next@16.3.5` bundles an `eslint-plugin-react` that still calls `context.getFilename`, which ESLint 10 removed. `create-next-app` pins 9 for the same reason. |
| P0 | `vite-tsconfig-paths` plugin in `vitest.config.ts` | `resolve.tsconfigPaths: true` | Vite 8 resolves tsconfig paths natively and warns about the plugin. |
| P0 | `cn` npm package | `src/lib/utils.ts` (`clsx` + `tailwind-merge`) | Same helper, one fewer dependency. |
| P0 | `GRANT CREATE ON DATABASE dept_test TO dept_app` only | granted on `dept`, `dept_test` and `dept_e2e` | pg-boss (`migrate: true`, running as `dept_app`) issues `CREATE SCHEMA IF NOT EXISTS pgboss`; PostgreSQL checks the database CREATE privilege before the existence check. |
| P0 | — | `ENV DATABASE_URL_MIGRATE=postgresql://build:build@db:5432/dept` in the Docker build stages | `prisma.config.ts` resolves the variable with `env()` at load time, which `prisma generate` (postinstall) needs even though it never connects. Runtime environments override it. |
| P0 | Playwright HTML report under `tests/e2e/.results/html` | `tests/e2e/.report` | Playwright refuses an HTML report folder inside `outputDir`. |
| P0 | `@prisma/internals` `getDMMF` named import | default import, then destructure | The package is CommonJS; Node's ESM loader cannot see `getDMMF` as a named export. |
| P2 | Departments created through `auth.api.createOrganization` with a compensating department row | `departmentService.create` writes the `organization` and `department` rows in one Prisma transaction | The plugin endpoint adds the caller as a member with `creatorRole`, which a faculty administrator must not become, and it cannot run inside the same transaction as the department row. The organization table is exactly what the plugin reads afterwards. |
| P2 | `requireDeptContext` calls `setActiveOrganization` on every request | The department comes from the URL slug; `selectDepartmentAction` records `activeOrganizationId` once (administrators who are not members get the session row updated directly because the plugin endpoint refuses non-members) | Setting cookies during a server-component render is not allowed in Next 16, and the slug already identifies the department unambiguously. |
| P2 | `/set-password/[token]` and `/reset-password/[token]` segments | `/set-password?token=` and `/reset-password?token=` | better-auth's reset endpoint redirects to `callbackURL?token=…`; the query form needs no rewrite. |
| P2 | better-auth rate limiting always on in production | `rateLimit.enabled` follows `AUTH_RATE_LIMIT` (default on in production builds; `compose.e2e.yaml` sets `0`) | The Playwright setup project signs seven seeded users in from one IP, which exceeds the built-in 3-per-10-seconds rule on `/sign-in/email`. |
| P2 | Coverage measured on integration + worker only | `npm run test:coverage` runs all four Vitest projects in the `test` service | `can()` and the matrix are covered by unit tests; the 85 % identity threshold only holds when unit coverage is merged in. |
