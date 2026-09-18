// Permission levels (section 30 of the requirements) and what each level lets an actor do.
//   full        any action in scope
//   manage      any action except the keys listed in SystemSetting rbac.manageExcludedPermissions
//   review      read plus review/approve transitions (reviewer relationship or department-scope grant)
//   own         when the actor is the subject's owner
//   assigned    when the actor is an assignee (directly, via a group) or member/chair of the context group
//   participate when the actor is the subject's target or an invited participant
//   limited     read and comment only, for requesters, minutes participants and section representatives
//   view        read only
//   submit      create and edit own submissions only
//   none        explicit deny (wins over every other grant)

export type PermissionLevelKey =
  | "full"
  | "manage"
  | "review"
  | "own"
  | "assigned"
  | "participate"
  | "limited"
  | "view"
  | "submit"
  | "none";

export type ActionVerb = "read" | "comment" | "submit" | "act" | "review" | "manage" | "approve";

/** Levels whose holder may be granted access without a subject relationship. */
export const UNCONDITIONAL_LEVELS: ReadonlySet<PermissionLevelKey> = new Set([
  "full",
  "manage",
  "view",
  "submit",
]);

/** Levels that require a relationship to the subject. */
export const RELATIONAL_LEVELS: ReadonlySet<PermissionLevelKey> = new Set([
  "own",
  "assigned",
  "participate",
  "limited",
  "review",
]);

const RANK: Record<PermissionLevelKey, number> = {
  none: 0,
  view: 1,
  limited: 2,
  submit: 3,
  participate: 4,
  assigned: 5,
  own: 6,
  review: 7,
  manage: 8,
  full: 9,
};

export function higherLevel(a: PermissionLevelKey, b: PermissionLevelKey): PermissionLevelKey {
  return RANK[a] >= RANK[b] ? a : b;
}

const VERB_LEVELS: Record<ActionVerb, ReadonlySet<PermissionLevelKey>> = {
  read: new Set([
    "view",
    "limited",
    "submit",
    "participate",
    "assigned",
    "own",
    "review",
    "manage",
    "full",
  ]),
  comment: new Set(["limited", "participate", "assigned", "own", "review", "manage", "full"]),
  submit: new Set(["submit", "participate", "assigned", "own", "review", "manage", "full"]),
  act: new Set(["participate", "assigned", "own", "review", "manage", "full"]),
  review: new Set(["review", "manage", "full"]),
  manage: new Set(["manage", "full"]),
  approve: new Set(["review", "full"]),
};

/** Whether a granted level permits the action verb. */
export function allowsAction(level: PermissionLevelKey, verb: ActionVerb): boolean {
  return VERB_LEVELS[verb].has(level);
}

export type Relationship =
  | "owner"
  | "creator"
  | "assignee"
  | "member"
  | "chair"
  | "target"
  | "participant"
  | "reviewer"
  | "requester"
  | "section_rep"
  | "minutes_participant";

/** Whether a relational level is satisfied by the actor's relationships to the subject. */
export function relationshipSatisfies(
  level: PermissionLevelKey,
  rels: ReadonlySet<Relationship>,
): boolean {
  switch (level) {
    case "own":
      return rels.has("owner");
    case "assigned":
      return rels.has("assignee") || rels.has("member") || rels.has("chair");
    case "participate":
      return rels.has("target") || rels.has("participant");
    case "limited":
      return rels.has("requester") || rels.has("minutes_participant") || rels.has("section_rep");
    case "review":
      return rels.has("reviewer");
    default:
      return false;
  }
}
