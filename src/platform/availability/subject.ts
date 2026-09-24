import { register } from "../subject-registry";

// How the rest of the system sees the ledger. A block is rarely addressed on its own — it is
// read through its owner — but audit rows, documents and notifications all address subjects, so
// both tables are registered.

export function registerAvailabilitySubjects(): void {
  register("availability_policy", {
    label: async (db, id) => {
      const policy = await db.availabilityPolicy.findUnique({ where: { id } });
      if (!policy) return null;
      const owner = await db.person.findUnique({ where: { id: policy.ownerPersonId } });
      return `${owner?.fullName ?? "somebody"} · ${policy.purpose}`;
    },
    snapshot: async (db, id) => {
      const policy = await db.availabilityPolicy.findUnique({ where: { id } });
      if (!policy) return null;
      return {
        label: policy.purpose,
        departmentId: policy.departmentId,
        data: { purpose: policy.purpose, validFrom: policy.validFrom, validTo: policy.validTo },
      };
    },
    contextOf: async (db, id) => {
      const policy = await db.availabilityPolicy.findUnique({ where: { id } });
      return policy
        ? { departmentId: policy.departmentId, ownerPersonId: policy.ownerPersonId }
        : null;
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const policy = await db.availabilityPolicy.findUnique({ where: { id } });
      return policy?.ownerPersonId === personId ? ["owner"] : [];
    },
    url: (_id, deptSlug) => `/d/${deptSlug}/availability`,
  });

  register("availability_block", {
    label: async (db, id) => {
      const block = await db.availabilityBlock.findUnique({ where: { id } });
      return block ? `${block.kind} ${block.startAt.toISOString().slice(0, 16)}` : null;
    },
    snapshot: async (db, id) => {
      const block = await db.availabilityBlock.findUnique({ where: { id } });
      if (!block) return null;
      return {
        label: block.kind,
        departmentId: block.departmentId,
        data: {
          ownerType: block.ownerType,
          ownerId: block.ownerId,
          startAt: block.startAt,
          endAt: block.endAt,
          severity: block.severity,
        },
      };
    },
    contextOf: async (db, id) => {
      const block = await db.availabilityBlock.findUnique({ where: { id } });
      if (!block) return null;
      return {
        departmentId: block.departmentId,
        ...(block.ownerType === "person" ? { ownerPersonId: block.ownerId } : {}),
        ...(block.sourceType && block.sourceId
          ? { parentRef: { subjectType: block.sourceType, subjectId: block.sourceId } }
          : {}),
      };
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const block = await db.availabilityBlock.findUnique({ where: { id } });
      return block?.ownerType === "person" && block.ownerId === personId ? ["owner"] : [];
    },
  });
}
