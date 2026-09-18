import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import internals from "@prisma/internals";

// @prisma/internals is CommonJS; named ESM imports of getDMMF fail under Node, so destructure.
const { getDMMF } = internals;

export type SchemaFile = [path: string, content: string];

export const SCHEMA_DIR = resolve(process.cwd(), "prisma/schema");

/** Reads every *.prisma file of the multi-file schema folder, sorted for determinism. */
export function loadSchemaFiles(dir: string = SCHEMA_DIR): SchemaFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".prisma"))
    .sort()
    .map((name) => [join(dir, name), readFileSync(join(dir, name), "utf8")] as SchemaFile);
}

/** Parses the schema into the DMMF. Accepts an explicit file list for tests and fixtures. */
export async function loadDmmf(files: SchemaFile[] = loadSchemaFiles()) {
  return getDMMF({ datamodel: files });
}

export type Dmmf = Awaited<ReturnType<typeof loadDmmf>>;
export type DmmfModel = Dmmf["datamodel"]["models"][number];
export type DmmfField = DmmfModel["fields"][number];

export const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

export function tableName(model: DmmfModel): string {
  return model.dbName ?? model.name;
}

export function columnName(field: DmmfField): string {
  return field.dbName ?? field.name;
}

export function departmentField(model: DmmfModel): DmmfField | undefined {
  return model.fields.find((f) => f.name === "departmentId" && f.kind === "scalar");
}

/** True when the model has a relation field to Department driven by its departmentId column. */
export function hasDepartmentRelation(model: DmmfModel): boolean {
  return model.fields.some(
    (f) =>
      f.kind === "object" &&
      f.type === "Department" &&
      (f.relationFromFields ?? []).includes("departmentId"),
  );
}
