import { randomBytes } from "node:crypto";

/**
 * A collision-resistant id in the shape the database's `cuid()` default produces.
 *
 * Almost every row gets its id from Prisma. A FeatureRecord cannot: it and its WorkflowInstance
 * point at each other, so one of the two ids has to exist before either row is written.
 */
export function newId(prefix = "c"): string {
  return `${prefix}${Date.now().toString(36)}${randomBytes(9).toString("hex")}`;
}
