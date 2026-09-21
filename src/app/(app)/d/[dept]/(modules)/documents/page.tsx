import { FilesIcon } from "lucide-react";
import { actorOf } from "@/lib/auth/require";
import { dbOf, pageContextCan } from "@/lib/auth/page";
import { accessView, canManageDocument, canReadDocument, myUploads } from "@/platform/document";
import { gateFor } from "@/platform/document/gate";
import { label, url } from "@/platform/subject-registry";
import { DocumentList, type DocumentRow } from "@/components/documents/DocumentList";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SegmentedLinks } from "@/components/patterns/SegmentedLinks";
import { StatCard } from "@/components/patterns/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  person: "People",
  task: "Tasks",
  committee: "Committees",
  meeting: "Meetings",
  portfolio: "Portfolios",
  course_offering: "Offerings",
  comment: "Comments",
};

/**
 * Department document browser: counts per subject type, the documents of one type (only the
 * ones the actor may read), and the actor's own uploads.
 */
export default async function DocumentsPage(props: PageProps<"/d/[dept]/documents">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContextCan(dept, "document.read");
  const db = dbOf(ctx);
  const actor = actorOf(ctx);
  const gate = gateFor(db, actor);
  const path = `/d/${dept}/documents`;

  const counts = await db.documentLink.groupBy({
    by: ["subjectType"],
    where: { document: { deletedAt: null } },
    _count: { _all: true },
  });
  const types = counts
    .map((c) => ({ type: c.subjectType, n: c._count._all }))
    .sort((a, b) => b.n - a.n);
  const view = typeof params.view === "string" ? params.view : "mine";
  const activeType = view === "mine" ? null : (types.find((t) => t.type === view)?.type ?? null);

  const rows: (DocumentRow & { where?: { label: string; href: string | null } })[] = [];
  if (activeType) {
    const links = await db.documentLink.findMany({
      where: { subjectType: activeType as never, document: { deletedAt: null } },
      include: {
        document: {
          include: { links: true, grants: true, versions: { orderBy: { versionNo: "desc" } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const seen = new Set<string>();
    for (const l of links) {
      if (seen.has(l.documentId)) continue;
      seen.add(l.documentId);
      const d = l.document;
      const current = d.versions[0];
      if (!current) continue;
      if (!(await canReadDocument(gate, accessView(d))).allowed) continue;
      const ref = { subjectType: l.subjectType, subjectId: l.subjectId };
      rows.push({
        id: d.id,
        title: d.title,
        currentVersionNo: d.currentVersionNo,
        mimeType: current.mimeType,
        sizeBytes: current.sizeBytes,
        uploadedAt: current.uploadedAt.toISOString(),
        linkRole: l.linkRole,
        slotKey: l.slotKey || undefined,
        category: d.category,
        canManage: (await canManageDocument(gate, accessView(d))).allowed,
        where: { label: await label(db, ref).catch(() => ref.subjectId), href: url(ref, dept) },
      });
    }
  } else {
    for (const d of await myUploads(db, actor)) {
      const current = d.versions[0];
      if (!current) continue;
      const first = d.links[0];
      const ref = first ? { subjectType: first.subjectType, subjectId: first.subjectId } : null;
      rows.push({
        id: d.id,
        title: d.title,
        currentVersionNo: d.currentVersionNo,
        mimeType: current.mimeType,
        sizeBytes: current.sizeBytes,
        uploadedAt: current.uploadedAt.toISOString(),
        linkRole: first?.linkRole,
        category: d.category,
        canManage: true,
        where: ref
          ? { label: await label(db, ref).catch(() => ref.subjectId), href: url(ref, dept) }
          : undefined,
      });
    }
  }
  const total = types.reduce((n, t) => n + t.n, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Documents"
        description="Every file in the department lives here, attached to the record it belongs to. Upload from that record's page."
        actions={
          <SegmentedLinks
            label="View"
            items={[
              { label: "My uploads", href: `${path}?view=mine`, active: !activeType },
              ...types.map((t) => ({
                label: TYPE_LABELS[t.type] ?? t.type,
                href: `${path}?view=${t.type}`,
                active: activeType === t.type,
                count: t.n,
              })),
            ]}
          />
        }
      />
      <section aria-label="Totals" className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Linked documents" value={total} icon={<FilesIcon />} />
        <StatCard label="Subject types" value={types.length} />
        <StatCard label="Your uploads" value={activeType ? "—" : rows.length} />
      </section>
      <Card>
        <CardHeader>
          <CardTitle>
            {activeType ? (TYPE_LABELS[activeType] ?? activeType) : "My uploads"}
          </CardTitle>
          <CardDescription>
            {activeType
              ? "Documents attached to records of this type that you may read."
              : "Files you uploaded anywhere in this department."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <EmptyState
              icon={<FilesIcon />}
              title={
                activeType ? "Nothing you may read here" : "You have not uploaded anything yet"
              }
              hint="Open a person, task or meeting page and use its Upload button; the file appears here."
            />
          ) : (
            <>
              <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
                {rows
                  .filter((r) => r.where)
                  .slice(0, 12)
                  .map((r) => (
                    <li key={`where-${r.id}`} className="truncate">
                      <span className="text-foreground">{r.title}</span> →{" "}
                      {r.where!.href ? (
                        <a className="underline" href={r.where!.href}>
                          {r.where!.label}
                        </a>
                      ) : (
                        r.where!.label
                      )}
                    </li>
                  ))}
              </ul>
              <DocumentList dept={dept} rows={rows} path={path} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
