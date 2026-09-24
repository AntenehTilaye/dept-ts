import type { Db } from "@/lib/db/types";
import type { Actor } from "@/platform/identity/can";
import type { AvailableAction as EngineAction } from "@/platform/workflow/engine";
import { availableActions as engineActions } from "@/platform/workflow/engine";
import {
  definitionOfRecord,
  getDefinition,
  listRecords,
  listViewOf,
  type ListFilters,
  type ResolvedDefinition,
} from "@/platform/feature";
import type { TimelineStep } from "@/components/feature/StepTimeline";
import type { FieldValue } from "@/components/feature/FieldRenderer";

// The read models the generic pages render. They translate one compiled definition plus its rows
// into exactly the shapes the shared record components already take, which is what lets a feature
// an administrator composed look like a page somebody wrote.

export interface ListRow {
  id: string;
  number: string;
  title: string;
  state: string;
  stateLabel: string;
  owner: string | null;
  assignee: string | null;
  deadline: Date | null;
  presetKey: string | null;
  createdAt: Date;
  data: Record<string, unknown>;
}

export interface ListModel {
  resolved: ResolvedDefinition;
  view: ReturnType<typeof listViewOf>;
  rows: ListRow[];
}

export async function featureList(
  db: Db,
  departmentId: string,
  featureKey: string,
  opts: { view?: string | null; filters?: ListFilters; personId?: string | null } = {},
): Promise<ListModel> {
  const resolved = await getDefinition(db, departmentId, featureKey);
  const view = listViewOf(resolved.def, opts.view);
  const records = await listRecords(
    db,
    departmentId,
    resolved,
    view,
    opts.filters ?? {},
    opts.personId,
  );

  const personIds = new Set<string>();
  for (const record of records) {
    personIds.add(record.ownerPersonId);
    for (const step of record.steps)
      if (step.assigneeType === "person" && step.assigneeId) personIds.add(step.assigneeId);
  }
  const people = await db.person.findMany({
    where: { id: { in: Array.from(personIds) } },
    select: { id: true, fullName: true },
  });
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
  const labels = stateLabels(resolved);

  return {
    resolved,
    view,
    rows: records.map((record) => {
      const active = record.steps[0];
      return {
        id: record.id,
        number: record.number,
        title: record.title,
        state: record.currentStateKey,
        stateLabel: labels[record.currentStateKey] ?? record.currentStateKey,
        owner: nameOf.get(record.ownerPersonId) ?? null,
        assignee:
          active?.assigneeType === "person" && active.assigneeId
            ? (nameOf.get(active.assigneeId) ?? null)
            : null,
        deadline: record.deadlineAt,
        presetKey: record.presetKey,
        createdAt: record.createdAt,
        data: (record.data as Record<string, unknown>) ?? {},
      };
    }),
  };
}

export function stateLabels(resolved: ResolvedDefinition): Record<string, string> {
  const out: Record<string, string> = {};
  for (const leaf of resolved.tree.leaves) out[leaf.step.key] = leaf.step.label;
  for (const parallel of resolved.tree.parallels) out[parallel.group.key] = parallel.group.label;
  for (const terminal of resolved.def.terminalStates) out[terminal.key] = terminal.label;
  return out;
}

export interface RecordModel {
  record: Awaited<ReturnType<Db["featureRecord"]["findUniqueOrThrow"]>>;
  resolved: ResolvedDefinition;
  fields: FieldValue[];
  steps: TimelineStep[];
  actions: EngineAction[];
  activeSteps: { id: string; stepKey: string; branchKey: string | null; label: string }[];
  parentLabel: string | null;
}

export async function featureRecord(
  db: Db,
  recordId: string,
  actor: Actor | null,
): Promise<RecordModel | null> {
  const record = await db.featureRecord.findUnique({ where: { id: recordId } });
  if (!record) return null;
  const resolved = await definitionOfRecord(db, record);
  const instances = await db.featureStepInstance.findMany({
    where: { recordId },
    orderBy: [{ enteredAt: "asc" }],
  });
  const labels = stateLabels(resolved);

  const personIds = new Set<string>([record.ownerPersonId, record.createdByPersonId]);
  for (const step of instances)
    if (step.assigneeType === "person" && step.assigneeId) personIds.add(step.assigneeId);
  const people = await db.person.findMany({
    where: { id: { in: Array.from(personIds) } },
    select: { id: true, fullName: true },
  });
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));

  const data = (record.data as Record<string, unknown>) ?? {};
  const fields: FieldValue[] = resolved.def.record.fields
    .filter((field) => field.type !== "section_header")
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: formatValue(data[field.key]),
    }));
  fields.push(
    { key: "owner", label: "Owner", value: nameOf.get(record.ownerPersonId) ?? "—" },
    {
      key: "deadline",
      label: "Deadline",
      value: record.deadlineAt ? record.deadlineAt.toISOString().slice(0, 16).replace("T", " ") : "none",
    },
  );

  const steps: TimelineStep[] = resolved.tree.leaves.map((leaf) => {
    const entries = instances.filter((i) => i.stepKey === leaf.step.key);
    const last = entries.at(-1);
    return {
      key: leaf.step.key,
      label: leaf.step.label,
      status: !last
        ? "pending"
        : last.status === "active"
          ? "current"
          : last.status === "rejected"
            ? "rejected"
            : last.status === "skipped"
              ? "skipped"
              : "done",
      at: last?.completedAt?.toISOString() ?? last?.enteredAt.toISOString() ?? null,
      actor:
        last?.assigneeType === "person" && last.assigneeId
          ? (nameOf.get(last.assigneeId) ?? null)
          : null,
    };
  });

  const actions = await engineActions(db, record.workflowInstanceId, actor);
  const active = instances
    .filter((i) => i.status === "active")
    .map((i) => ({
      id: i.id,
      stepKey: i.stepKey,
      branchKey: i.branchKey,
      label: labels[i.stepKey] ?? i.stepKey,
    }));

  return {
    record,
    resolved,
    fields,
    steps,
    actions,
    activeSteps: active,
    parentLabel: record.parentSubjectType
      ? `${record.parentSubjectType}: ${record.parentSubjectId}`
      : null,
  };
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map((v) => formatValue(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
