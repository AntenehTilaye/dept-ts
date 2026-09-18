import type { Relationship } from "../identity/levels";
import type { Db } from "../../lib/db/types";

// The SubjectRegistry contract (design part 01 §SubjectRegistry). Every kernel service refers to
// any entity through a SubjectRef; each owning service registers, per subject type, how to
// label, snapshot, contextualise, expose relationships, supply template variables, index and
// link its rows. Registrations are functions over a client passed by the caller (the caller's
// department transaction, or a department-scoped client built from the actor's department).

export interface SubjectRef {
  subjectType: string;
  subjectId: string;
}

/** Scope ids a subject lives in; `parentRef` lets contextOf inherit the parent's context. */
export interface SubjectContext {
  departmentId?: string;
  ownerPersonId?: string;
  groupId?: string;
  sectionId?: string;
  programId?: string;
  termId?: string;
  committeeId?: string;
  sectionOfferingId?: string;
  labScheduleId?: string;
  meetingId?: string;
  featureRecordId?: string;
  parentRef?: SubjectRef;
}

export interface SubjectSnapshot {
  label: string;
  status?: string;
  departmentId?: string;
  /** Denormalised fields worth keeping in audit/search rows. */
  data?: Record<string, unknown>;
}

export interface SearchDoc {
  title: string;
  body: string;
  keywords?: string[];
}

export interface SubjectRegistration {
  /** Human label for lists, notifications and audit rows. */
  label(db: Db, subjectId: string): Promise<string | null>;
  /** Existence + denormalised snapshot; null when the row is gone. */
  snapshot(db: Db, subjectId: string): Promise<SubjectSnapshot | null>;
  /** Scope ids for permission matching; may return `parentRef` for inheritance. */
  contextOf(db: Db, subjectId: string): Promise<SubjectContext | null>;
  /** The actor's relationships to the subject (owner, assignee, member, chair, ...). */
  relationships(db: Db, subjectId: string, personId: string | null): Promise<Relationship[]>;
  /** Template variables ({{course_name}}, ...). */
  variables?(db: Db, subjectId: string): Promise<Record<string, unknown>>;
  /** Search projection. */
  indexDoc?(db: Db, subjectId: string): Promise<SearchDoc | null>;
  /** Canonical in-app URL (department slug supplied by the caller). */
  url?(subjectId: string, deptSlug: string): string;
  onChanged?(db: Db, subjectId: string): Promise<void>;
  onDeleted?(db: Db, subjectId: string): Promise<void>;
}
