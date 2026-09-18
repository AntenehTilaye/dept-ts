import type { ResourceKind, ResourceStatus } from "@/generated/prisma/enums";
import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";

export interface ResourceInput {
  id?: string;
  code: string;
  name: string;
  kind: ResourceKind;
  building?: string | null;
  location?: string | null;
  capacity?: number | null;
  responsiblePersonId?: string | null;
  computerCount?: number | null;
  softwareList?: string[];
  attributes?: Record<string, unknown>;
  status?: ResourceStatus;
}

export async function upsertResource(db: Db, departmentId: string, input: ResourceInput) {
  const data = {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    kind: input.kind,
    building: input.building ?? null,
    location: input.location ?? null,
    capacity: input.capacity ?? null,
    responsiblePersonId: input.responsiblePersonId ?? null,
    computerCount: input.computerCount ?? null,
    softwareList: input.softwareList ?? [],
    attributesJson: toJson(input.attributes ?? {}),
    ...(input.status ? { status: input.status } : {}),
  };
  if (input.id) return db.resource.update({ where: { id: input.id }, data });
  return db.resource.create({ data: { departmentId, ...data } });
}

export async function listResources(db: Db, departmentId: string, kind?: ResourceKind) {
  return db.resource.findMany({
    where: { departmentId, ...(kind ? { kind } : {}) },
    include: { responsible: { select: { id: true, fullName: true } } },
    orderBy: { code: "asc" },
  });
}

export async function getResource(db: Db, id: string) {
  return db.resource.findUnique({ where: { id }, include: { responsible: true } });
}
