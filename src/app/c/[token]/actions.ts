"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { mapActionError, type ActionResult } from "@/lib/actions/safe-action";
import { withTenantTx } from "@/lib/db/tenant";
import { clientKey, rateLimiter } from "@/lib/rate-limit";
import { runWithAudit } from "@/platform/audit/context";
import { CampaignError, departmentOfToken, submitViaToken } from "@/platform/campaign";
import { SubmissionValidationError } from "@/platform/forms";

// The public submit action. There is no session: the token is the credential, so the call is
// rate limited per address and the department is derived from the invitation itself.

const Input = z.object({
  token: z.string().min(10).max(200),
  answers: z.record(z.string(), z.unknown()),
});

/** A few submissions a minute per address is plenty for a human filling one form. */
const limiter = () => rateLimiter("campaign:submit", { capacity: 10, refillPerSecond: 0.2 });

export async function submitCampaignAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success)
    return { ok: false, code: "validation", message: "The submission was malformed." };
  const gate = limiter().take(clientKey(await headers()));
  if (!gate.ok)
    return {
      ok: false,
      code: "error",
      message: "Too many attempts; please wait a moment and try again.",
    };

  try {
    // the invitation carries its department; the public route has no context of its own
    const departmentId = await departmentOfToken(parsed.data.token);
    if (!departmentId) return { ok: false, code: "forbidden", message: "This link is not valid." };
    const submission = await runWithAudit(
      { departmentId, actorUserId: null, correlationId: "public:campaign" },
      () =>
        withTenantTx(departmentId, (tx) =>
          submitViaToken(tx, parsed.data.token, parsed.data.answers),
        ),
    );
    return { ok: true, data: { id: submission.id } };
  } catch (error) {
    if (error instanceof SubmissionValidationError)
      return {
        ok: false,
        code: "validation",
        message: "Please correct the highlighted answers.",
        issues: error.issues,
      };
    if (error instanceof CampaignError)
      return { ok: false, code: "forbidden", message: error.message };
    return mapActionError(error);
  }
}
