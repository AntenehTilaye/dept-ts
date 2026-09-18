/**
 * Row-Level Security generator.
 *
 *   tsx prisma/scripts/gen-rls.ts                 # refresh prisma/rls-manifest.json, print SQL for uncovered tables
 *   tsx prisma/scripts/gen-rls.ts --check         # exit 1 when the manifest is stale or a tenant table has no policy
 *   tsx prisma/scripts/gen-rls.ts --append <migration.sql>   # append policies for uncovered tables, refresh manifest
 *
 * Classification (from the Prisma DMMF, using dbName so the SQL uses the real snake_case names):
 *   tenant : required `departmentId`  -> strict policy, FORCE ROW LEVEL SECURITY
 *   shared : optional `departmentId`  -> nullable policy (NULL = faculty-wide row, written only under bypass)
 *   global : no `departmentId`        -> no RLS
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  columnName,
  departmentField,
  hasDepartmentRelation,
  loadDmmf,
  tableName,
  type Dmmf,
  type SchemaFile,
} from "./dmmf";

export type Classification = "tenant" | "shared" | "global";

export interface Manifest {
  tenant: string[];
  shared: string[];
  global: string[];
  hash: string;
}

export interface ClassifiedTable {
  model: string;
  table: string;
  column: string | null;
  kind: Classification;
  hasRelation: boolean;
}

export const MANIFEST_PATH = resolve(process.cwd(), "prisma/rls-manifest.json");
export const MIGRATIONS_DIR = resolve(process.cwd(), "prisma/migrations");

const CURRENT = "current_setting('app.current_department_id', true)";
const BYPASS = "current_setting('app.tenant_bypass', true) = 'on'";

export function classify(dmmf: Dmmf): ClassifiedTable[] {
  return dmmf.datamodel.models
    .map((model) => {
      const field = departmentField(model);
      const kind: Classification = !field ? "global" : field.isRequired ? "tenant" : "shared";
      return {
        model: model.name,
        table: tableName(model),
        column: field ? columnName(field) : null,
        kind,
        hasRelation: field ? hasDepartmentRelation(model) : true,
      };
    })
    .sort((a, b) => a.table.localeCompare(b.table));
}

export function manifestHash(lists: Pick<Manifest, "tenant" | "shared" | "global">): string {
  const canonical = JSON.stringify({
    tenant: [...lists.tenant].sort(),
    shared: [...lists.shared].sort(),
    global: [...lists.global].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildManifest(tables: ClassifiedTable[]): Manifest {
  const lists = {
    tenant: tables.filter((t) => t.kind === "tenant").map((t) => t.table),
    shared: tables.filter((t) => t.kind === "shared").map((t) => t.table),
    global: tables.filter((t) => t.kind === "global").map((t) => t.table),
  };
  return { ...lists, hash: manifestHash(lists) };
}

export function policySql(table: ClassifiedTable): string {
  if (table.kind === "global" || !table.column) return "";
  const col = `"${table.column}"`;
  const strict = `${col} = ${CURRENT} OR ${BYPASS}`;
  const using = table.kind === "tenant" ? strict : `${col} IS NULL OR ${strict}`;
  const check = table.kind === "tenant" ? strict : `(${col} IS NULL AND ${BYPASS}) OR ${strict}`;
  return [
    `-- ${table.kind}: ${table.model}`,
    `ALTER TABLE "${table.table}" ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE "${table.table}" FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY tenant_isolation ON "${table.table}"`,
    `  USING (${using})`,
    `  WITH CHECK (${check});`,
    "",
  ].join("\n");
}

/** Tables that already have a tenant_isolation policy in any migration file. */
export function coveredTables(migrationsDir: string = MIGRATIONS_DIR): Set<string> {
  const covered = new Set<string>();
  if (!existsSync(migrationsDir)) return covered;
  for (const entry of readdirSync(migrationsDir)) {
    const file = join(migrationsDir, entry, "migration.sql");
    if (!statSync(join(migrationsDir, entry)).isDirectory() || !existsSync(file)) continue;
    const sql = readFileSync(file, "utf8");
    for (const match of sql.matchAll(/CREATE POLICY tenant_isolation ON "?([A-Za-z0-9_]+)"?/g)) {
      covered.add(match[1]!);
    }
  }
  return covered;
}

export function readManifest(path: string = MANIFEST_PATH): Manifest | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

export function writeManifest(manifest: Manifest, path: string = MANIFEST_PATH): void {
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
}

export function check(
  tables: ClassifiedTable[],
  manifest: Manifest | null,
  covered: Set<string>,
): CheckResult {
  const problems: string[] = [];
  const fresh = buildManifest(tables);
  if (!manifest) problems.push("prisma/rls-manifest.json is missing; run `npm run rls:gen`");
  else if (manifest.hash !== fresh.hash)
    problems.push("prisma/rls-manifest.json is stale; run `npm run rls:gen`");
  if (manifest) {
    const listed = new Set([...manifest.tenant, ...manifest.shared, ...manifest.global]);
    for (const t of tables) {
      if (!listed.has(t.table))
        problems.push(`model ${t.model} (${t.table}) is not classified in the manifest`);
    }
  }
  for (const t of tables) {
    if (t.kind !== "global" && !covered.has(t.table)) {
      problems.push(`${t.kind} table ${t.table} has no tenant_isolation policy in any migration`);
    }
    if (t.kind !== "global" && !t.hasRelation) {
      problems.push(`model ${t.model} has departmentId without a relation to Department`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export function uncoveredSql(tables: ClassifiedTable[], covered: Set<string>): string {
  const pending = tables.filter((t) => t.kind !== "global" && !covered.has(t.table));
  if (pending.length === 0) return "";
  const header = `-- generated by gen-rls.ts; manifest-hash=${buildManifest(tables).hash}\n`;
  return header + pending.map(policySql).join("\n");
}

export async function run(argv: string[], files?: SchemaFile[]): Promise<number> {
  const dmmf = await loadDmmf(files);
  const tables = classify(dmmf);
  const covered = coveredTables();

  if (argv.includes("--check")) {
    const result = check(tables, readManifest(), covered);
    if (!result.ok) {
      for (const p of result.problems) console.error(`rls:check: ${p}`);
      return 1;
    }
    console.log(
      `rls:check: ok (${tables.filter((t) => t.kind === "tenant").length} tenant, ${tables.filter((t) => t.kind === "shared").length} shared, ${tables.filter((t) => t.kind === "global").length} global)`,
    );
    return 0;
  }

  const manifest = buildManifest(tables);
  writeManifest(manifest);
  const sql = uncoveredSql(tables, covered);
  const appendIndex = argv.indexOf("--append");
  if (appendIndex >= 0) {
    const target = argv[appendIndex + 1];
    if (!target) {
      console.error("--append requires a migration.sql path");
      return 1;
    }
    if (sql) appendFileSync(resolve(process.cwd(), target), `\n${sql}`);
    console.log(sql ? `rls:gen: appended policies to ${target}` : "rls:gen: nothing to append");
    return 0;
  }
  if (sql) process.stdout.write(sql);
  else console.log("rls:gen: manifest refreshed; every tenant table is already covered");
  return 0;
}

const invokedDirectly = process.argv[1] && /gen-rls\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
