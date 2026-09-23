import { register } from "../subject-registry";

// SubjectRegistry registration for campaigns (and their subjects), so reminders, documents and
// notifications can address them like any other record.

export function registerCampaignSubjects(): void {
  register("campaign", {
    label: async (db, id) => (await db.campaign.findUnique({ where: { id } }))?.title ?? null,
    snapshot: async (db, id) => {
      const c = await db.campaign.findUnique({ where: { id } });
      return c
        ? {
            label: c.title,
            status: c.closedAt ? "closed" : c.publishedAt ? "open" : "draft",
            departmentId: c.departmentId,
            data: { kind: c.kind, closesAt: c.resolvedClosesAt },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const c = await db.campaign.findUnique({ where: { id } });
      return c ? { departmentId: c.departmentId, termId: c.termId } : null;
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const invited = await db.campaignInvitation.findFirst({
        where: { campaignId: id, personId },
        select: { id: true },
      });
      return invited ? ["participant"] : [];
    },
    variables: async (db, id) => {
      const c = await db.campaign.findUnique({ where: { id } });
      return c
        ? {
            campaign_title: c.title,
            title: c.title,
            deadline: c.resolvedClosesAt.toISOString().slice(0, 10),
          }
        : {};
    },
    url: (id, slug) => `/d/${slug}/campaigns/${id}/results`,
  });

  register("campaign_subject", {
    label: async (db, id) =>
      (await db.campaignSubject.findUnique({ where: { id } }))?.label ?? null,
    snapshot: async (db, id) => {
      const s = await db.campaignSubject.findUnique({ where: { id } });
      return s ? { label: s.label, departmentId: s.departmentId } : null;
    },
    contextOf: async (db, id) => {
      const s = await db.campaignSubject.findUnique({ where: { id } });
      return s
        ? {
            departmentId: s.departmentId,
            parentRef: { subjectType: "campaign", subjectId: s.campaignId },
          }
        : null;
    },
    relationships: async () => [],
  });
}
