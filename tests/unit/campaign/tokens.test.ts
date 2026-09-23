import { describe, expect, it } from "vitest";
import {
  checkToken,
  hashToken,
  newToken,
  pseudonym,
  sameHash,
  tokenUrl,
  TOKEN_BYTES,
  type TokenState,
} from "@/platform/campaign/tokens";

const HOUR = 3_600_000;
const now = new Date("2026-09-23T12:00:00Z");

function state(over: Partial<TokenState> = {}): TokenState {
  return {
    status: "pending",
    expiresAt: new Date(now.getTime() + 24 * HOUR),
    opensAt: new Date(now.getTime() - HOUR),
    closesAt: new Date(now.getTime() + 24 * HOUR),
    submissionRule: "single",
    ...over,
  };
}

describe("campaign tokens", () => {
  it("issues high-entropy tokens and stores only their hash", () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64url")).toHaveLength(TOKEN_BYTES);
    expect(hashToken(a)).toHaveLength(64);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
    expect(sameHash(hashToken(a), hashToken(a))).toBe(true);
    expect(sameHash(hashToken(a), hashToken(b))).toBe(false);
    expect(tokenUrl(a)).toBe(`/c/${encodeURIComponent(a)}`);
    expect(tokenUrl(a, "https://x.test/")).toBe(`https://x.test/c/${encodeURIComponent(a)}`);
  });

  it("accepts a pending token inside the window", () => {
    expect(checkToken(state(), now)).toEqual({ ok: true, editing: false });
  });

  it("refuses expired, not-yet-open and closed windows", () => {
    expect(checkToken(state({ expiresAt: new Date(now.getTime() - 1) }), now)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(checkToken(state({ status: "expired" }), now)).toEqual({ ok: false, reason: "expired" });
    expect(checkToken(state({ opensAt: new Date(now.getTime() + HOUR) }), now)).toEqual({
      ok: false,
      reason: "not_open",
    });
    expect(checkToken(state({ closesAt: new Date(now.getTime() - HOUR) }), now)).toEqual({
      ok: false,
      reason: "closed",
    });
  });

  it("enforces the submission rule on a second use", () => {
    expect(checkToken(state({ status: "submitted" }), now)).toEqual({ ok: false, reason: "used" });
    expect(
      checkToken(state({ status: "submitted", submissionRule: "editable_until_close" }), now),
    ).toEqual({ ok: true, editing: true });
    expect(checkToken(state({ status: "submitted", submissionRule: "multiple" }), now)).toEqual({
      ok: true,
      editing: false,
    });
    expect(
      checkToken(
        state({
          status: "submitted",
          submissionRule: "editable_until_close",
          closesAt: new Date(now.getTime() - 1),
        }),
        now,
      ),
    ).toEqual({ ok: false, reason: "closed" });
  });

  it("pseudonyms are stable per campaign and person but differ across both", () => {
    expect(pseudonym("c1", "p1", "s")).toBe(pseudonym("c1", "p1", "s"));
    expect(pseudonym("c1", "p1", "s")).not.toBe(pseudonym("c2", "p1", "s"));
    expect(pseudonym("c1", "p1", "s")).not.toBe(pseudonym("c1", "p2", "s"));
    expect(pseudonym("c1", "p1", "s")).not.toBe(pseudonym("c1", "p1", "other"));
  });
});
