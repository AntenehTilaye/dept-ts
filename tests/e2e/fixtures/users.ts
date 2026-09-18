// Seeded users whose sessions the `setup` project stores under tests/e2e/.auth/<key>.json.
// Empty until authentication arrives; later phases add admin, dh.cs, dpt.cs, instructor1.cs,
// chair.cs, rep.cs and dh.ee.
export interface E2eUser {
  key: string;
  email: string;
  password: string;
}

export const E2E_PASSWORD = "Passw0rd!dev";

export const E2E_USERS: E2eUser[] = [];

export function storageStatePath(key: string): string {
  return `tests/e2e/.auth/${key}.json`;
}
