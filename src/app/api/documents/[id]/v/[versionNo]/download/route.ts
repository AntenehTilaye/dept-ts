import { Readable } from "node:stream";
import { env } from "@/lib/env";
import { getSession } from "@/lib/auth/require";
import { withTenantTx } from "@/lib/db/tenant";
import { storage } from "@/lib/storage";
import { recordDownload, verifyDownload } from "@/platform/document";

export const dynamic = "force-dynamic";

// Streams one version after verifying the signed link (issued by downloadUrl() after the
// permission check). The link is bound to the user it was issued to; the session must match.

function refuse(status: number, message: string): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain" } });
}

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/documents/[id]/v/[versionNo]/download">,
): Promise<Response> {
  const { id, versionNo } = await ctx.params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const verdict = verifyDownload(token, env().BETTER_AUTH_SECRET);
  if (!verdict.ok) {
    return refuse(
      verdict.reason === "expired" ? 410 : 403,
      verdict.reason === "expired"
        ? "This download link has expired; open the document again to get a fresh one."
        : "Invalid download link.",
    );
  }
  const claims = verdict.claims;
  if (claims.documentId !== id || String(claims.versionNo) !== versionNo)
    return refuse(403, "Invalid download link.");
  const session = await getSession();
  if (!session || session.user.id !== claims.userId)
    return refuse(403, "This download link was issued to another account.");

  const version = await withTenantTx(claims.departmentId, async (tx) => {
    const v = await tx.documentVersion.findUnique({
      where: { documentId_versionNo: { documentId: id, versionNo: claims.versionNo } },
      include: { document: { select: { deletedAt: true, departmentId: true } } },
    });
    if (!v || v.document.deletedAt) return null;
    await recordDownload(
      tx,
      { userId: session.user.id, departmentId: v.document.departmentId },
      id,
      claims.versionNo,
      { userAgent: request.headers.get("user-agent") ?? undefined },
    );
    return v;
  });
  if (!version) return refuse(404, "Document not found.");

  const stream = await storage().get(version.storageKey);
  const filename = version.originalName.replace(/[^\w.\- ]+/g, "_") || "download";
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": version.mimeType,
      "Content-Length": String(version.sizeBytes),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
