import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Architectural boundaries (see docs/design): modules compose platform services, never the
// reverse; platform services are framework-free.
const platformMayNotImport = [
  { name: "next", message: "src/platform must stay framework-free." },
  { name: "next/navigation", message: "src/platform must stay framework-free." },
  { name: "next/headers", message: "src/platform must stay framework-free." },
  { name: "next/server", message: "src/platform must stay framework-free." },
  { name: "next/cache", message: "src/platform must stay framework-free." },
  { name: "react", message: "src/platform must stay framework-free." },
  { name: "server-only", message: "src/platform must stay framework-free." },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Playwright fixtures receive a callback named `use`, which is not a React hook.
    files: ["tests/e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  {
    files: ["src/platform/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: platformMayNotImport,
          patterns: [
            {
              group: ["@/modules/*", "@/modules/**", "**/modules/**"],
              message: "src/platform may not import src/modules.",
            },
            {
              group: ["@/app/*", "@/app/**"],
              message: "src/platform may not import the app router.",
            },
            {
              group: ["@/components/*", "@/components/**"],
              message: "src/platform may not import UI components.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*/**", "@/modules/*/*", "@/modules/*/**"],
              message:
                "Modules may only import their own files, src/platform, src/lib and src/components.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/worker/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next", message: "The worker never imports Next." },
            { name: "react", message: "The worker never imports React." },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "apps/worker/dist/**",
    "coverage/**",
    "tests/e2e/.results/**",
    "tests/e2e/.auth/**",
    "docs/**",
  ]),
]);
