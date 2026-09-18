import { prismaRoot } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prismaRoot.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, db: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, db: false, error: message }, { status: 503 });
  }
}
