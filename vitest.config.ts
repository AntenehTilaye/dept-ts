import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Four projects: unit (pure), components (jsdom), integration (real Postgres, per-run schema,
// RLS on) and worker (real pg-boss on a per-run schema). E2E lives in Playwright.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      include: ["src/platform/**", "apps/worker/src/handlers/**"],
      exclude: ["src/generated/**", "**/*.d.ts", "**/types.ts", "**/index.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
        "src/platform/feature/**": { lines: 90, branches: 85 },
        "src/platform/workflow/**": { lines: 90, branches: 85 },
        "src/platform/identity/**": { lines: 85 },
      },
    },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "components",
          include: ["tests/components/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["tests/setup/dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/setup/global-db.ts"],
          setupFiles: ["tests/setup/db-each.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/setup/global-db.ts", "tests/setup/global-boss.ts"],
          setupFiles: ["tests/setup/db-each.ts"],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
