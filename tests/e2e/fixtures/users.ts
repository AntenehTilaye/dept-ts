// Seeded users whose sessions the `setup` project stores under tests/e2e/.auth/<key>.json.
// Mirrors prisma/seed/users.ts (same password).
export interface E2eUser {
  key: string;
  email: string;
  password: string;
}

export const E2E_PASSWORD = "Passw0rd!dev";

export const E2E_USERS: E2eUser[] = [
  "admin",
  "dh.cs",
  "dpt.cs",
  "instructor1.cs",
  "chair.cs",
  "rep.cs",
  "dh.ee",
].map((key) => ({ key, email: `${key}@deptts.local`, password: E2E_PASSWORD }));

export function storageStatePath(key: string): string {
  return `tests/e2e/.auth/${key}.json`;
}
