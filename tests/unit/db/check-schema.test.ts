import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadDmmf, loadSchemaFiles, type SchemaFile } from "../../../prisma/scripts/dmmf";
import { checkSchema } from "../../../prisma/scripts/check-schema";
import { jsonSchemas } from "@/lib/db/json-schemas";

function fixture(name: string): SchemaFile {
  const path = resolve("tests/fixtures/schemas", name);
  return [path, readFileSync(path, "utf8")];
}

// loading the DMMF parses every schema file through Prisma, which is seconds rather than
// milliseconds on a loaded machine
vi.setConfig({ testTimeout: 60_000 });

describe("check-schema", () => {
  it("reports a model without @@map, a camelCase field without @map, an unregistered Json column and a bad enum value", async () => {
    const problems = checkSchema(await loadDmmf([fixture("bad-conventions.prisma")]), new Set());
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/model NoMap has no @@map/),
        expect.stringMatching(/NoMap\.fullName maps to "fullName"/),
        expect.stringMatching(/NoMap\.metaJson has no Zod schema/),
        expect.stringMatching(/enum Bad value Yes is not lower_snake/),
      ]),
    );
  });

  it("accepts the real schema with the registered Json schemas", async () => {
    const problems = checkSchema(
      await loadDmmf(loadSchemaFiles()),
      new Set(Object.keys(jsonSchemas)),
    );
    expect(problems).toEqual([]);
  });
});
