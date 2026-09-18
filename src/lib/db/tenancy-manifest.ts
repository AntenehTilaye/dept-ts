import manifestJson from "../../../prisma/rls-manifest.json" with { type: "json" };

// Prisma model names by tenancy class, from the committed manifest that gen-rls.ts maintains.
//   TENANT  required departmentId, FORCE ROW LEVEL SECURITY
//   SHARED  nullable departmentId (NULL = faculty-wide row, written only under bypass)
//   GLOBAL  no departmentId, no RLS
interface ManifestEntry {
  model: string;
  table: string;
}

interface Manifest {
  tenant: ManifestEntry[];
  shared: ManifestEntry[];
  global: ManifestEntry[];
  hash: string;
}

const manifest: Manifest = manifestJson;

export const TENANT_MODELS: ReadonlySet<string> = new Set(manifest.tenant.map((e) => e.model));
export const SHARED_MODELS: ReadonlySet<string> = new Set(manifest.shared.map((e) => e.model));
export const GLOBAL_MODELS: ReadonlySet<string> = new Set(manifest.global.map((e) => e.model));

export function tenancyOf(model: string): "tenant" | "shared" | "global" {
  if (TENANT_MODELS.has(model)) return "tenant";
  if (SHARED_MODELS.has(model)) return "shared";
  if (GLOBAL_MODELS.has(model)) return "global";
  throw new Error(
    `Model ${model} is not classified in prisma/rls-manifest.json (run npm run rls:gen)`,
  );
}
