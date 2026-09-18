import {
  allowsAction,
  higherLevel,
  relationshipSatisfies,
  UNCONDITIONAL_LEVELS,
  type ActionVerb,
  type PermissionLevelKey,
  type Relationship,
} from "./levels";

// The single policy decision point. Framework-free; data comes from an injected PolicyStore
// (database-backed in src/lib/auth, in-memory in unit tests) and subject context from an
// injected SubjectResolver (the SubjectRegistry from the registry phase on).

import type { SubjectContext, SubjectRef } from "../subject-registry/types";

export type { SubjectContext, SubjectRef };

export interface SubjectResolver {
  contextOf(ref: SubjectRef, departmentId: string): Promise<SubjectContext>;
  relationships(
    ref: SubjectRef,
    personId: string | null,
    departmentId: string,
  ): Promise<Relationship[]>;
}

export interface Actor {
  userId: string;
  personId: string | null;
  departmentId: string;
  isAdmin: boolean;
}

export interface Grant {
  roleKey: string;
  scopeType: string;
  scopeId: string;
}

export interface PolicyStore {
  /** Effective (department override over faculty default) level per role key per permission key. */
  rolePermissions(departmentId: string): Promise<Map<string, Map<string, PermissionLevelKey>>>;
  /** The actor's active RoleGrant rows in the department (any scope). */
  activeGrants(userId: string, departmentId: string, now: Date): Promise<Grant[]>;
  /** Keys a `manage` level does not cover (SystemSetting rbac.manageExcludedPermissions). */
  manageExcluded(departmentId: string): Promise<ReadonlySet<string>>;
  /** Registered permission keys (Permission table). */
  registeredKeys(): Promise<ReadonlySet<string>>;
}

export interface Decision {
  allowed: boolean;
  level: PermissionLevelKey;
  reason: string;
}

/** Keys even a global administrator does not hold (acting as a respondent, for example). */
export const ADMIN_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "evaluation.participate",
  "campaign.respond",
]);

const SCOPE_CONTEXT_KEY: Record<string, keyof SubjectContext> = {
  committee: "committeeId",
  section: "sectionId",
  program: "programId",
  section_offering: "sectionOfferingId",
  lab_schedule: "labScheduleId",
  meeting: "meetingId",
  feature_record: "featureRecordId",
};

const nullResolver: SubjectResolver = {
  async contextOf() {
    return {};
  },
  async relationships() {
    return [];
  },
};

let resolver: SubjectResolver = nullResolver;

/** The registry phase installs the real SubjectRegistry here. */
export function setSubjectResolver(next: SubjectResolver): void {
  resolver = next;
}

/** Feature presets register `{prefix}.{action}` -> generic key fallbacks (evaluation.close -> campaign.manage). */
const fallbacks = new Map<string, string>();

export function registerPermissionFallback(prefix: string, genericKey: string): void {
  fallbacks.set(prefix, genericKey);
}

export function resolvePermissionKey(key: string, registered: ReadonlySet<string>): string {
  if (registered.has(key)) return key;
  const dot = key.lastIndexOf(".");
  if (dot > 0) {
    const generic = fallbacks.get(key.slice(0, dot));
    if (generic) return generic;
  }
  return key;
}

export interface CanOptions {
  now?: Date;
  verb?: ActionVerb;
}

export async function can(
  store: PolicyStore,
  actor: Actor,
  permissionKey: string,
  subjectRef?: SubjectRef,
  opts: CanOptions = {},
): Promise<Decision> {
  const key = resolvePermissionKey(permissionKey, await store.registeredKeys());
  const verb = opts.verb;

  if (actor.isAdmin && !ADMIN_EXCLUDED_KEYS.has(key))
    return { allowed: true, level: "full", reason: "global administrator" };

  const [matrix, grants, excluded] = await Promise.all([
    store.rolePermissions(actor.departmentId),
    store.activeGrants(actor.userId, actor.departmentId, opts.now ?? new Date()),
    store.manageExcluded(actor.departmentId),
  ]);
  if (grants.length === 0)
    return { allowed: false, level: "none", reason: "no active role in this department" };

  const levelsOf = (roleKey: string): PermissionLevelKey | undefined =>
    matrix.get(roleKey)?.get(key);

  // 1. explicit deny wins
  for (const g of grants)
    if (levelsOf(g.roleKey) === "none")
      return { allowed: false, level: "none", reason: `explicit deny for ${g.roleKey}` };

  // 2. which grants apply: department-wide always; scoped ones only inside the subject's context
  const context = subjectRef ? await resolver.contextOf(subjectRef, actor.departmentId) : {};
  if (subjectRef && context.departmentId && context.departmentId !== actor.departmentId) {
    return { allowed: false, level: "none", reason: "subject belongs to another department" };
  }
  const applicable = grants.filter((g) => {
    if (g.scopeType === "department" || g.scopeType === "global") return true;
    const ctxKey = SCOPE_CONTEXT_KEY[g.scopeType];
    return !!ctxKey && !!subjectRef && context[ctxKey] === g.scopeId;
  });

  let rels: ReadonlySet<Relationship> | undefined;
  let best: PermissionLevelKey = "none";
  let reason = "no matching permission";

  for (const g of applicable) {
    const level = levelsOf(g.roleKey);
    if (!level || level === "none") continue;
    let ok = false;
    if (level === "full") ok = true;
    else if (level === "manage") ok = !excluded.has(key);
    else if (level === "review" && (g.scopeType === "department" || g.scopeType === "global"))
      ok = true;
    else if (UNCONDITIONAL_LEVELS.has(level)) ok = true;
    else if (level === "assigned" && g.scopeType !== "department" && g.scopeType !== "global")
      ok = true; // scoped grant already proves membership
    else if (subjectRef) {
      rels ??= new Set(
        await resolver.relationships(subjectRef, actor.personId, actor.departmentId),
      );
      ok = relationshipSatisfies(level, rels);
    }
    if (ok) {
      if (best === "none" || higherLevel(level, best) === level) {
        best = level;
        reason = `${g.roleKey}@${g.scopeType} grants ${level}`;
      }
    } else if (best === "none") {
      reason =
        level === "manage"
          ? `${key} is excluded from manage`
          : `${g.roleKey} holds ${level} but the relationship is missing`;
    }
  }

  if (best === "none") return { allowed: false, level: "none", reason };
  if (verb && !allowsAction(best, verb))
    return { allowed: false, level: best, reason: `${best} does not allow ${verb}` };
  return { allowed: true, level: best, reason };
}
