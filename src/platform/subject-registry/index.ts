import { globalSingleton } from "../../lib/singleton";
import type { Db } from "../../lib/db/types";
import type { Relationship } from "../identity/levels";
import type { SubjectContext, SubjectRef, SubjectRegistration, SubjectSnapshot } from "./types";

export type * from "./types";

// In-memory registry populated once per process by src/lib/bootstrap.ts (web) and the worker
// entry point. Registrations are keyed by SubjectType enum member name and read through the
// client the caller supplies (its department transaction, or a scoped client for can()).

const registrations = globalSingleton(
  "subject-registry",
  () => new Map<string, SubjectRegistration>(),
);

export class UnknownSubjectTypeError extends Error {
  constructor(subjectType: string) {
    super(`No subject registration for "${subjectType}"`);
    this.name = "UnknownSubjectTypeError";
  }
}

export class SubjectNotFoundError extends Error {
  constructor(ref: SubjectRef) {
    super(`${ref.subjectType} ${ref.subjectId} does not exist`);
    this.name = "SubjectNotFoundError";
  }
}

export function register(subjectType: string, registration: SubjectRegistration): void {
  if (registrations.has(subjectType))
    throw new Error(`Subject type "${subjectType}" is already registered`);
  registrations.set(subjectType, registration);
}

/** Test helper: replaces or removes a registration. */
export function replace(subjectType: string, registration: SubjectRegistration | null): void {
  if (registration) registrations.set(subjectType, registration);
  else registrations.delete(subjectType);
}

export function resolve(subjectType: string): SubjectRegistration {
  const r = registrations.get(subjectType);
  if (!r) throw new UnknownSubjectTypeError(subjectType);
  return r;
}

export function isRegistered(subjectType: string): boolean {
  return registrations.has(subjectType);
}

export function types(): string[] {
  return Array.from(registrations.keys()).sort();
}

export async function exists(db: Db, ref: SubjectRef): Promise<boolean> {
  return (await resolve(ref.subjectType).snapshot(db, ref.subjectId)) !== null;
}

/** Called before every polymorphic write (documents, threads, notifications, grants). */
export async function assertExists(db: Db, ref: SubjectRef): Promise<void> {
  if (!(await exists(db, ref))) throw new SubjectNotFoundError(ref);
}

export async function label(db: Db, ref: SubjectRef): Promise<string> {
  return (
    (await resolve(ref.subjectType).label(db, ref.subjectId)) ??
    `${ref.subjectType} ${ref.subjectId}`
  );
}

export async function snapshot(db: Db, ref: SubjectRef): Promise<SubjectSnapshot | null> {
  return resolve(ref.subjectType).snapshot(db, ref.subjectId);
}

/**
 * Context of a subject with parent inheritance: a child's own ids win, missing ones are
 * filled from `parentRef` (recursively, cycle-guarded).
 */
export async function contextOf(db: Db, ref: SubjectRef, depth = 0): Promise<SubjectContext> {
  const own = (await resolve(ref.subjectType).contextOf(db, ref.subjectId)) ?? {};
  // Unregistered parent types (modules of later phases) contribute nothing.
  if (!own.parentRef || depth > 8 || !registrations.has(own.parentRef.subjectType))
    return stripParent(own);
  const parent = await contextOf(db, own.parentRef, depth + 1);
  return { ...parent, ...stripParent(own) };
}

function stripParent(ctx: SubjectContext): SubjectContext {
  const { parentRef: _parent, ...rest } = ctx;
  return Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as SubjectContext;
}

export async function relationships(
  db: Db,
  ref: SubjectRef,
  personId: string | null,
): Promise<Relationship[]> {
  return resolve(ref.subjectType).relationships(db, ref.subjectId, personId);
}

export async function variables(db: Db, ref: SubjectRef): Promise<Record<string, unknown>> {
  return (await resolve(ref.subjectType).variables?.(db, ref.subjectId)) ?? {};
}

export function url(ref: SubjectRef, deptSlug: string): string | null {
  return resolve(ref.subjectType).url?.(ref.subjectId, deptSlug) ?? null;
}

/** Builds the SubjectResolver can() consumes from a department-scoped client factory. */
export function resolverWith(dbFor: (departmentId: string) => Db) {
  return {
    contextOf: (ref: SubjectRef, departmentId: string) => contextOf(dbFor(departmentId), ref),
    relationships: (ref: SubjectRef, personId: string | null, departmentId: string) =>
      relationships(dbFor(departmentId), ref, personId),
  };
}
