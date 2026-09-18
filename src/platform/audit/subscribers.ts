import {
  syncGroupGrants,
  syncGroupMembershipGrants,
  syncMemberGrants,
  syncPersonGrants,
  syncRepresentativeGrants,
  syncStudentSectionGrants,
  syncTeachingGrants,
} from "../identity/derive";
import { subscribe } from "./outbox";
import { globalSingleton } from "../../lib/singleton";

// The subscriber table: derived-grant synchronisation reacts to registry events. The people
// and academic services still call derive synchronously (immediate consistency in the same
// transaction); these subscribers repair grants for writes that bypassed the services
// (better-auth organization endpoints, imports) and are the hook later phases extend.

const state = globalSingleton("grant-subscribers", () => ({ installed: false }));

function payloadString(payload: unknown, key: string): string | null {
  const v = (payload as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : null;
}

export function installGrantSubscribers(): void {
  if (state.installed) return;
  state.installed = true;

  subscribe("member.changed", "grants.member", async (e) => {
    const userId = payloadString(e.payloadJson, "userId");
    const organizationId = payloadString(e.payloadJson, "organizationId");
    if (userId && organizationId) await syncMemberGrants(userId, organizationId);
  });
  subscribe("member.removed", "grants.member", async (e) => {
    const userId = payloadString(e.payloadJson, "userId");
    const organizationId = payloadString(e.payloadJson, "organizationId");
    if (userId && organizationId) await syncMemberGrants(userId, organizationId);
  });
  subscribe("group.membership.changed", "grants.group_membership", async (e, tx) => {
    if (e.departmentId) await syncGroupMembershipGrants(tx, e.departmentId, e.aggregateId);
  });
  subscribe("group.status.changed", "grants.group", async (e, tx) => {
    if (e.departmentId) await syncGroupGrants(tx, e.departmentId, e.aggregateId);
  });
  subscribe("teaching.assigned", "grants.teaching", async (e, tx) => {
    if (e.departmentId) await syncTeachingGrants(tx, e.departmentId, e.aggregateId);
  });
  subscribe("teaching.ended", "grants.teaching", async (e, tx) => {
    if (e.departmentId) await syncTeachingGrants(tx, e.departmentId, e.aggregateId);
  });
  subscribe("representative.changed", "grants.representative", async (e, tx) => {
    if (e.departmentId) await syncRepresentativeGrants(tx, e.departmentId, e.aggregateId);
  });
  subscribe("student.section_membership.changed", "grants.student_section", async (e, tx) => {
    const studentId = payloadString(e.payloadJson, "studentId") ?? e.aggregateId;
    if (e.departmentId) await syncStudentSectionGrants(tx, e.departmentId, studentId);
  });
  subscribe("person.user_linked", "grants.person", async (e, tx) => {
    if (e.departmentId) await syncPersonGrants(tx, e.departmentId, e.aggregateId);
  });
}
