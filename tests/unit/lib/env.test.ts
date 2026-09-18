import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const base = {
  DATABASE_URL: "postgresql://dept_app:dept_app@db:5432/dept",
  DATABASE_URL_MIGRATE: "postgresql://dept_migrator:dept_migrator@db:5432/dept",
  BETTER_AUTH_SECRET: "dev-only-secret-please-change-0123456789",
};

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

describe("env", () => {
  it("rejects a missing DATABASE_URL", () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it("applies defaults and coerces numbers", () => {
    const env = parseEnv({ ...base, PG_POOL_MAX: "7" });
    expect(env.PG_POOL_MAX).toBe(7);
    expect(env.APP_TIMEZONE).toBe("Africa/Addis_Ababa");
    expect(env.SEED_DEMO).toBe("0");
  });

  it("accepts .env.example merged with the compose defaults", () => {
    const example = parseDotEnv(readFileSync(".env.example", "utf8"));
    const env = parseEnv({ ...base, ...example });
    expect(env.UPLOAD_MAX_MB).toBe(25);
  });
});
