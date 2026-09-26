import { NextResponse } from "next/server";
import { dbOf, pageContext } from "@/lib/auth/page";
import { requireCan } from "@/lib/auth/require";
import { columnsFor, templateCsv, templateWorkbook } from "@/platform/import";

// The template for one section's sheet. It is built rather than stored because its columns are the
// section's own assessment components: a marker downloads a workbook that already has the right
// columns, fills it in and hands the same shape back.

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ dept: string; sectionOfferingId: string }> },
) {
  const { dept, sectionOfferingId } = await params;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "attendance" ? "attendance" : "assessment";
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";

  const ctx = await pageContext(dept);
  const db = dbOf(ctx);
  await requireCan(
    ctx,
    "assessment.import",
    { subjectType: "section_offering", subjectId: sectionOfferingId },
    "submit",
  );

  const section = await db.sectionOffering.findUnique({
    where: { id: sectionOfferingId },
    include: { courseOffering: { include: { course: { select: { code: true } } } } },
  });
  if (!section) return new NextResponse("Not found", { status: 404 });

  const columns = await columnsFor(kind, db, {
    subjectType: "section_offering",
    subjectId: sectionOfferingId,
  });
  const base = `${section.courseOffering.course.code}-${section.sectionCode}-${kind}`;

  if (format === "csv")
    return new NextResponse(templateCsv(kind, columns), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${base}.csv"`,
      },
    });

  const workbook = await templateWorkbook(
    kind,
    { course: section.courseOffering.course.code, section: section.sectionCode },
    columns,
  );
  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${base}.xlsx"`,
    },
  });
}
