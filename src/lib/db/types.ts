import type { Prisma } from "@/generated/prisma/client";

/**
 * The client shape every platform service accepts: a department transaction (`withTenantTx`),
 * a bypass transaction, or a department-scoped client (`getDb`). Extended clients are
 * structurally compatible with the transaction client for model delegates.
 */
export type Db = Prisma.TransactionClient;
