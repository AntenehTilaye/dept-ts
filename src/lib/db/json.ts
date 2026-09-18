import type { Prisma } from "@/generated/prisma/client";

/** Narrows a boundary-validated value to Prisma's JSON input type. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** Reads a JSON column back as a typed value (validated by the caller's Zod schema when needed). */
export function fromJson<T>(value: Prisma.JsonValue): T {
  return value as unknown as T;
}
