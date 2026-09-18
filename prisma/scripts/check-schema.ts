/**
 * Schema conventions guard (part of `npm run check`):
 *   - every model is @@map'ed to snake_case, every non-relation field is @map'ed to snake_case
 *     (single-word lowercase names such as `key` or `scope` need no @map),
 *   - every Json column has a Zod schema registered in src/lib/db/json-schemas.ts,
 *   - every model with `departmentId` declares the relation to Department,
 *   - the hand-applied back-relations on the generated auth models survive regeneration,
 *   - enum values are lower_snake.
 */
import {
  columnName,
  departmentField,
  hasDepartmentRelation,
  loadDmmf,
  SNAKE_CASE,
  tableName,
  type Dmmf,
  type SchemaFile,
} from "./dmmf";

export function checkSchema(dmmf: Dmmf, jsonSchemaKeys: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const modelNames = new Set(dmmf.datamodel.models.map((m) => m.name));

  for (const model of dmmf.datamodel.models) {
    const table = tableName(model);
    if (!model.dbName) problems.push(`model ${model.name} has no @@map`);
    if (!SNAKE_CASE.test(table))
      problems.push(`model ${model.name} maps to "${table}", which is not snake_case`);

    for (const field of model.fields) {
      if (field.kind === "object") continue;
      const column = columnName(field);
      if (!SNAKE_CASE.test(column)) {
        problems.push(
          `field ${model.name}.${field.name} maps to "${column}", which is not snake_case (add @map)`,
        );
      }
      if (field.type === "Json" && !jsonSchemaKeys.has(`${model.name}.${field.name}`)) {
        problems.push(
          `Json field ${model.name}.${field.name} has no Zod schema in src/lib/db/json-schemas.ts`,
        );
      }
    }

    if (departmentField(model) && !hasDepartmentRelation(model)) {
      problems.push(`model ${model.name} has departmentId without a relation to Department`);
    }
  }

  if (modelNames.has("User") && modelNames.has("Person")) {
    const user = dmmf.datamodel.models.find((m) => m.name === "User")!;
    if (!user.fields.some((f) => f.name === "person" && f.kind === "object")) {
      problems.push(
        "auth model User lost its `person Person?` back-relation (re-apply after `npx auth generate`)",
      );
    }
  }
  if (modelNames.has("Organization")) {
    const org = dmmf.datamodel.models.find((m) => m.name === "Organization")!;
    if (!org.fields.some((f) => f.name === "department" && f.kind === "object")) {
      problems.push(
        "auth model Organization lost its `department Department?` back-relation (re-apply after `npx auth generate`)",
      );
    }
  }

  for (const e of dmmf.datamodel.enums) {
    for (const v of e.values) {
      if (!SNAKE_CASE.test(v.name))
        problems.push(`enum ${e.name} value ${v.name} is not lower_snake`);
    }
  }

  return problems;
}

export async function run(files?: SchemaFile[]): Promise<number> {
  const [dmmf, { jsonSchemas }] = await Promise.all([
    loadDmmf(files),
    import("../../src/lib/db/json-schemas"),
  ]);
  const problems = checkSchema(dmmf, new Set(Object.keys(jsonSchemas)));
  if (problems.length) {
    for (const p of problems) console.error(`schema:check: ${p}`);
    return 1;
  }
  console.log(
    `schema:check: ok (${dmmf.datamodel.models.length} models, ${dmmf.datamodel.enums.length} enums)`,
  );
  return 0;
}

const invokedDirectly = process.argv[1] && /check-schema\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  run().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
