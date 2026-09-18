import { z } from "zod";

// Server-side environment contract. Everything here is set by compose.yaml (dev/test/e2e)
// or the host environment (prod). Parsed lazily so importing this module never throws in
// the browser bundle; call `env()` only from server code.
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_MIGRATE: z.string().url(),
  DATABASE_SCHEMA: z.string().min(1).default("public"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().default(""),
  SMTP_URL: z.string().min(1).default("smtp://mailpit:1025"),
  MAIL_FROM: z.string().min(3).default("DeptTS <noreply@deptts.local>"),
  MAILPIT_URL: z.string().url().optional(),
  UPLOAD_DIR: z.string().min(1).default("/data/uploads"),
  APP_TIMEZONE: z.string().min(1).default("Africa/Addis_Ababa"),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  PDF_CONCURRENCY: z.coerce.number().int().positive().default(2),
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(25),
  SEED_DEMO: z.enum(["0", "1"]).default("0"),
  SEED_AUTO_PUBLISH: z.enum(["0", "1"]).default("0"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv();
  return cached;
}
