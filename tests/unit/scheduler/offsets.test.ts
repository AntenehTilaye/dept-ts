import { describe, expect, it } from "vitest";
import {
  diffOccurrences,
  escalationKey,
  nextIntervalRun,
  occurrences,
  reminderKey,
  withinHorizon,
  DeadlineSpec,
} from "@/platform/scheduler/offsets";

const subject = { subjectType: "task", subjectId: "t1" };
const offsets = [-7, -3, -1, 0, 1].map((offsetDays) => ({
  offsetDays,
  templateKey: offsetDays > 0 ? "deadline_overdue" : "deadline_reminder",
  channels: ["in_app", "email"] as Array<"in_app" | "email">,
}));
const deadline = new Date("2026-10-01T09:00:00Z");

describe("reminder offsets", () => {
  it("produces the documented idempotency keys and run times, skipping past offsets", () => {
    const now = new Date("2026-09-20T00:00:00Z");
    const all = occurrences(subject, "default", offsets, deadline, now);
    expect(all.map((o) => o.idempotencyKey)).toEqual([
      "task:t1:default:-7",
      "task:t1:default:-3",
      "task:t1:default:-1",
      "task:t1:default:0",
      "task:t1:default:1",
    ]);
    expect(all[0]!.runAt.toISOString()).toBe("2026-09-24T09:00:00.000Z");
    expect(all[4]!.runAt.toISOString()).toBe("2026-10-02T09:00:00.000Z");
    expect(all.map((o) => o.overdue)).toEqual([false, false, false, false, true]);
    const late = occurrences(
      subject,
      "default",
      offsets,
      deadline,
      new Date("2026-09-29T00:00:00Z"),
    );
    expect(late.map((o) => o.offsetDays)).toEqual([-1, 0, 1]);
    expect(reminderKey(subject, "s", -3)).toBe("task:t1:s:-3");
    expect(escalationKey(subject, "s")).toBe("task:t1:s:escalation");
  });

  it("materialises only the offsets inside the 48 h horizon", () => {
    const now = new Date("2026-09-23T12:00:00Z");
    const all = occurrences(subject, "default", offsets, deadline, now);
    expect(withinHorizon(all, now).map((o) => o.offsetDays)).toEqual([-7]);
    const later = new Date("2026-09-30T00:00:00Z");
    expect(
      withinHorizon(occurrences(subject, "default", offsets, deadline, later), later).map(
        (o) => o.offsetDays,
      ),
    ).toEqual([-1, 0]);
    expect(withinHorizon(all, now, 24 * 30)).toHaveLength(5);
  });

  it("re-anchoring cancels and creates only the changed keys", () => {
    const now = new Date("2026-09-20T00:00:00Z");
    const before = occurrences(subject, "default", offsets, deadline, now);
    const moved = occurrences(subject, "default", offsets, new Date("2026-10-03T09:00:00Z"), now);
    const { cancel, create } = diffOccurrences(before, moved);
    expect(cancel).toHaveLength(5);
    expect(create).toHaveLength(5);
    const same = diffOccurrences(before, before);
    expect(same.cancel).toEqual([]);
    expect(same.create).toEqual([]);
    const fewer = diffOccurrences(
      before,
      occurrences(subject, "default", offsets.slice(0, 2), deadline, now),
    );
    expect(fewer.cancel.map((o) => o.offsetDays)).toEqual([-1, 0, 1]);
    expect(fewer.create).toEqual([]);
  });

  it("interval next-run arithmetic is timezone-safe (UTC milliseconds)", () => {
    const since = new Date("2026-03-27T23:30:00Z");
    expect(nextIntervalRun(since, 3, new Date("2026-03-27T23:31:00Z")).toISOString()).toBe(
      "2026-03-30T23:30:00.000Z",
    );
    expect(nextIntervalRun(since, 3, new Date("2026-04-02T00:00:00Z")).toISOString()).toBe(
      "2026-04-02T23:30:00.000Z",
    );
    expect(nextIntervalRun(since, 3, new Date("2026-01-01T00:00:00Z")).toISOString()).toBe(
      "2026-03-30T23:30:00.000Z",
    );
  });

  it("parses the three deadline spec shapes", () => {
    expect("at" in DeadlineSpec.parse({ at: "2026-10-01T09:00:00Z" })).toBe(true);
    expect(
      DeadlineSpec.parse({ anchor: { periodKind: "add_drop", edge: "end", termId: "t" } }),
    ).toMatchObject({ anchor: { offsetDays: 0 } });
    expect(DeadlineSpec.parse({ everyDays: 2 })).toMatchObject({ whileInStates: [] });
    expect(DeadlineSpec.safeParse({ everyDays: 0 }).success).toBe(false);
  });
});
