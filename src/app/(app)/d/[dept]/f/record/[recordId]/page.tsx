import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { dbOf, pageContext } from "@/lib/auth/page";

export const dynamic = "force-dynamic";

// Where a link to a record goes when whoever minted it did not know which feature the record
// belongs to — notifications, search hits and the subject registry all address records by id
// alone. This resolves the feature and hands the reader its own page.

export default async function RecordResolverPage(
  props: PageProps<"/d/[dept]/f/record/[recordId]">,
) {
  const { dept, recordId } = await props.params;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);

  const record = await db.featureRecord.findUnique({
    where: { id: recordId },
    select: { definitionId: true },
  });
  if (!record) notFound();
  const definition = await db.featureDefinition.findUnique({
    where: { id: record.definitionId },
    select: { key: true },
  });
  if (!definition) notFound();
  redirect(`/d/${dept}/f/${definition.key}/${recordId}` as Route);
}
