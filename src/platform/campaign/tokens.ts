import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Invitation tokens: a 256-bit random value handed out once (in the mail), stored only as its
// sha256. A leaked database therefore cannot be used to impersonate a respondent, and the
// lookup is a single indexed equality on the hash.

export const TOKEN_BYTES = 32;

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison for hashes that were fetched by other means. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The public URL a respondent receives. */
export function tokenUrl(token: string, baseUrl?: string): string {
  const path = `/c/${encodeURIComponent(token)}`;
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path;
}

export type TokenRejection = "unknown" | "expired" | "used" | "not_open" | "closed";

export interface TokenState {
  status: "pending" | "opened" | "submitted" | "expired";
  expiresAt: Date;
  opensAt: Date;
  closesAt: Date;
  submissionRule: "single" | "editable_until_close" | "multiple";
}

/** Whether a token may be used to open the form right now, and why not. */
export function checkToken(
  state: TokenState,
  now: Date = new Date(),
): { ok: true; editing: boolean } | { ok: false; reason: TokenRejection } {
  if (state.status === "expired" || state.expiresAt.getTime() <= now.getTime())
    return { ok: false, reason: "expired" };
  if (now.getTime() < state.opensAt.getTime()) return { ok: false, reason: "not_open" };
  if (now.getTime() > state.closesAt.getTime()) return { ok: false, reason: "closed" };
  if (state.status === "submitted") {
    if (state.submissionRule === "editable_until_close") return { ok: true, editing: true };
    if (state.submissionRule === "multiple") return { ok: true, editing: false };
    return { ok: false, reason: "used" };
  }
  return { ok: true, editing: false };
}

/** Pseudonymous mode: a salted hash that is stable per campaign and person but not reversible. */
export function pseudonym(campaignId: string, personId: string, secret: string): string {
  return createHash("sha256").update(`${campaignId}:${personId}:${secret}`).digest("hex");
}
