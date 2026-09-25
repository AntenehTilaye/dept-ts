import { globalSingleton } from "../../../lib/singleton";
import type { Db } from "../../../lib/db/types";
import { registerProjection, type ProjectionRow } from "./registry";

// The projections the platform can answer on its own. A module phase registers its own (the
// portfolio status, the load cycle) the same way; nothing here knows about those.

const state = globalSingleton("built-in-projections", () => ({ installed: false }));

export function installBuiltInProjections(): void {
  if (state.installed) return;
  state.installed = true;

  // How much work is open, and whose. One row per person with anything assigned.
  registerProjection({
    key: "openWork",
    events: [
      "task.created",
      "task.deadline_changed",
      "workflow.transitioned",
      "feature.record.created",
    ],
    apply: async (event, tx) => openWorkRows(event.departmentId, tx),
    rebuild: async (departmentId, tx) => openWorkRows(departmentId, tx),
  });

  // What is waiting for somebody to look at it: records in a waiting state, by feature.
  registerProjection({
    key: "pendingByFeature",
    events: ["feature.record.created", "workflow.transitioned"],
    apply: async (event, tx) => pendingRows(event.departmentId, tx),
    rebuild: async (departmentId, tx) => pendingRows(departmentId, tx),
  });

  // How a campaign is going: invitations sent, opened and submitted.
  registerProjection({
    key: "campaignProgress",
    events: ["campaign.opened", "campaign.closed", "submission.submitted", "invitation.sent"],
    apply: async (event, tx) => campaignRows(event.departmentId, tx),
    rebuild: async (departmentId, tx) => campaignRows(departmentId, tx),
  });
}

/**
 * These projections recompute the department rather than patching one row. The tables are small
 * — a department's open work is hundreds of rows — and a recomputation cannot drift, which is
 * worth more here than the arithmetic saved. A projection over a large table registers an
 * `apply` that patches instead; the registry does not care which a projection chooses.
 */
async function openWorkRows(departmentId: string, tx: Db): Promise<ProjectionRow[]> {
  const tasks = await tx.task.findMany({
    where: { departmentId, completedAt: null },
    include: { assignments: true },
  });
  const now = new Date();
  const byPerson = new Map<string, { open: number; overdue: number }>();

  for (const task of tasks) {
    const overdue = task.dueAt && task.dueAt < now ? 1 : 0;
    for (const assignment of task.assignments) {
      if (assignment.assigneeType !== "person") continue;
      const current = byPerson.get(assignment.assigneeId) ?? { open: 0, overdue: 0 };
      byPerson.set(assignment.assigneeId, {
        open: current.open + 1,
        overdue: current.overdue + overdue,
      });
    }
  }

  return Array.from(byPerson.entries()).map(([personId, values]) => ({
    rowKey: `${departmentId}:${personId}`,
    dimensions: { personId },
    values,
  }));
}

async function pendingRows(departmentId: string, tx: Db): Promise<ProjectionRow[]> {
  const records = await tx.featureRecord.findMany({
    where: { departmentId, closedAt: null },
    select: { definitionId: true, currentStateKey: true, deadlineAt: true },
  });
  const definitions = await tx.featureDefinition.findMany({
    where: { id: { in: Array.from(new Set(records.map((r) => r.definitionId))) } },
    select: { id: true, key: true, name: true },
  });
  const nameOf = new Map(definitions.map((d) => [d.id, d]));
  const now = new Date();

  const byFeature = new Map<string, { name: string; open: number; overdue: number }>();
  for (const record of records) {
    const definition = nameOf.get(record.definitionId);
    if (!definition) continue;
    const current = byFeature.get(definition.key) ?? { name: definition.name, open: 0, overdue: 0 };
    byFeature.set(definition.key, {
      name: definition.name,
      open: current.open + 1,
      overdue: current.overdue + (record.deadlineAt && record.deadlineAt < now ? 1 : 0),
    });
  }

  return Array.from(byFeature.entries()).map(([featureKey, row]) => ({
    rowKey: `${departmentId}:${featureKey}`,
    dimensions: { featureKey, name: row.name },
    values: { open: row.open, overdue: row.overdue },
  }));
}

async function campaignRows(departmentId: string, tx: Db): Promise<ProjectionRow[]> {
  const campaigns = await tx.campaign.findMany({
    where: { departmentId },
    select: { id: true, title: true, kind: true },
  });
  const rows: ProjectionRow[] = [];
  for (const campaign of campaigns) {
    const invitations = await tx.campaignInvitation.groupBy({
      by: ["status"],
      where: { campaignId: campaign.id },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(invitations.map((i) => [i.status, i._count._all]));
    rows.push({
      rowKey: `${departmentId}:${campaign.id}`,
      dimensions: { campaignId: campaign.id, title: campaign.title, kind: campaign.kind },
      values: {
        invited: Object.values(counts).reduce((sum, n) => sum + n, 0),
        submitted: counts.submitted ?? 0,
        pending: (counts.pending ?? 0) + (counts.opened ?? 0),
      },
    });
  }
  return rows;
}
