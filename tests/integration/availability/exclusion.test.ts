import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import {
  checkConflicts,
  definePolicy,
  freeSlots,
  HardConflictError,
  registerBlocks,
  workloadIn,
} from "@/platform/availability";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

let personId: string;
let otherPersonId: string;
let resourceId: string;

// 2026-03-03 is a Tuesday. Addis Ababa is UTC+3 all year, so 09:00 local is 06:00Z.
const at = (iso: string) => new Date(iso);
const TUE_09 = at("2026-03-03T06:00:00Z");
const TUE_11 = at("2026-03-03T08:00:00Z");
const TUE_10 = at("2026-03-03T07:00:00Z");
const TUE_12 = at("2026-03-03T09:00:00Z");

beforeAll(async () => {
  const [p1, p2] = await Promise.all([
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
  ]);
  personId = p1.id;
  otherPersonId = p2.id;
  const resource = await withDept(DEPT_CS, (tx) =>
    tx.resource.create({
      data: {
        departmentId: DEPT_CS,
        code: `LAB-${f.uniqueSuffix().toUpperCase()}`,
        name: "Laboratory A",
        kind: "computer_lab",
      },
    }),
  );
  resourceId = resource.id;
});

const source = (name: string) => ({ subjectType: "meeting", subjectId: `${name}-${f.uniqueSuffix()}` });

describe("the busy-time ledger", () => {
  it("refuses a second hard block over the same person, and over the same room", async () => {
    const first = source("teaching");
    await withTenantTx(DEPT_CS, (tx) =>
      registerBlocks(tx, DEPT_CS, first, [
        { ownerType: "person", ownerId: personId, startAt: TUE_09, endAt: TUE_11, kind: "teaching" },
        { ownerType: "resource", ownerId: resourceId, startAt: TUE_09, endAt: TUE_11, kind: "teaching" },
      ]),
    );

    for (const owner of [
      { ownerType: "person" as const, ownerId: personId },
      { ownerType: "resource" as const, ownerId: resourceId },
    ]) {
      await expect(
        withTenantTx(DEPT_CS, (tx) =>
          registerBlocks(tx, DEPT_CS, source("exam"), [
            { ...owner, startAt: TUE_10, endAt: TUE_12, kind: "exam" },
          ]),
        ),
      ).rejects.toBeInstanceOf(HardConflictError);
    }

    // the error names what it collided with, which is what a page shows its reader
    const error = await withTenantTx(DEPT_CS, (tx) =>
      registerBlocks(tx, DEPT_CS, source("exam"), [
        { ownerType: "person", ownerId: personId, startAt: TUE_10, endAt: TUE_12, kind: "exam" },
      ]),
    ).then(
      () => null,
      (e: unknown) => e as HardConflictError,
    );
    expect(error).toBeInstanceOf(HardConflictError);
    expect(error!.colliding).toHaveLength(1);
    expect(error!.colliding[0]!.kind).toBe("teaching");

    // and the database says the same thing on its own
    await expect(
      migratorDb.availabilityBlock.create({
        data: {
          departmentId: DEPT_CS,
          ownerType: "person",
          ownerId: personId,
          startAt: TUE_10,
          endAt: TUE_12,
          kind: "meeting",
          severity: "hard",
        },
      }),
    ).rejects.toThrow(/no_hard_overlap/);
  });

  it("allows a soft block over a hard one, and lets a source rewrite its own blocks", async () => {
    const preference = source("preference");
    await withTenantTx(DEPT_CS, (tx) =>
      registerBlocks(tx, DEPT_CS, preference, [
        {
          ownerType: "person",
          ownerId: personId,
          startAt: TUE_10,
          endAt: TUE_12,
          kind: "meeting",
          severity: "soft",
        },
      ]),
    );
    // writing the same source again replaces what it wrote, so this is never a conflict
    const again = await withTenantTx(DEPT_CS, (tx) =>
      registerBlocks(tx, DEPT_CS, preference, [
        {
          ownerType: "person",
          ownerId: personId,
          startAt: TUE_10,
          endAt: TUE_12,
          kind: "meeting",
          severity: "soft",
        },
      ]),
    );
    expect(again).toHaveLength(1);
    expect(
      await migratorDb.availabilityBlock.count({
        where: { sourceType: "meeting", sourceId: preference.subjectId },
      }),
    ).toBe(1);
  });

  it("names every kind of conflict, and ignores the candidate's own source", async () => {
    const duty = source("duty");
    await withTenantTx(DEPT_CS, (tx) =>
      registerBlocks(tx, DEPT_CS, duty, [
        {
          ownerType: "person",
          ownerId: otherPersonId,
          startAt: TUE_09,
          endAt: TUE_11,
          kind: "invigilation",
        },
      ]),
    );

    const owners = [{ ownerType: "person" as const, ownerId: otherPersonId }];
    const conflicts = await withTenantTx(DEPT_CS, (tx) =>
      checkConflicts(tx, DEPT_CS, owners, { from: TUE_10, to: TUE_12 }),
    );
    expect(conflicts.map((c) => c.kind)).toEqual(["hard_overlap"]);

    // the same interval, checked on behalf of the source that wrote the block, is free
    const own = await withTenantTx(DEPT_CS, (tx) =>
      checkConflicts(tx, DEPT_CS, owners, { from: TUE_10, to: TUE_12 }, { ignoreSource: duty }),
    );
    expect(own).toEqual([]);

    // a purpose brings the policy's windows and its daily maximum into the answer
    await withTenantTx(DEPT_CS, (tx) =>
      definePolicy(tx, DEPT_CS, otherPersonId, {
        purpose: "appointments",
        weeklyWindows: [{ weekday: 2, from: "13:00", to: "16:00" }],
        slotMinutes: 30,
        maxPerPeriod: 1,
        validFrom: at("2026-01-01T00:00:00Z"),
      }),
    );
    const outside = await withTenantTx(DEPT_CS, (tx) =>
      checkConflicts(
        tx,
        DEPT_CS,
        owners,
        { from: TUE_09, to: TUE_10 },
        { purpose: "appointments", now: at("2026-03-01T00:00:00Z") },
      ),
    );
    expect(outside.map((c) => c.kind)).toContain("outside_windows");
    expect(outside.map((c) => c.kind)).toContain("max_per_period");
  });

  it("a policy's days away are hard blocks, and the free slots respect them", async () => {
    const policy = await withTenantTx(DEPT_CS, (tx) =>
      definePolicy(tx, DEPT_CS, personId, {
        purpose: "appointments",
        weeklyWindows: [{ weekday: 4, from: "09:00", to: "12:00" }],
        breakWindows: [{ from: "10:00", to: "10:30" }],
        blackoutPeriods: [
          { fromAt: at("2026-03-12T00:00:00Z"), toAt: at("2026-03-13T00:00:00Z"), reason: "Leave" },
        ],
        slotMinutes: 60,
        validFrom: at("2026-01-01T00:00:00Z"),
      }),
    );
    expect(policy.blackoutPeriods).toHaveLength(1);
    const blackouts = await migratorDb.availabilityBlock.findMany({
      where: { sourceType: "availability_policy", sourceId: policy.id },
    });
    expect(blackouts.map((b) => [b.kind, b.severity])).toEqual([["blackout", "hard"]]);

    // 2026-03-05 and 2026-03-12 are Thursdays; the second one is the day away
    const slots = await withTenantTx(DEPT_CS, (tx) =>
      freeSlots(
        tx,
        DEPT_CS,
        personId,
        { from: at("2026-03-02T00:00:00Z"), to: at("2026-03-15T00:00:00Z") },
        "appointments",
        at("2026-03-01T00:00:00Z"),
      ),
    );
    const days = new Set(slots.map((s) => s.from.toISOString().slice(0, 10)));
    expect(days).toEqual(new Set(["2026-03-05"]));
    // the break splits the morning, so the 10:00 hour is not offered
    expect(slots.map((s) => s.from.toISOString().slice(11, 16))).toEqual(["06:00", "07:30"]);
  });

  it("workload adds up the hours a person's blocks hold in a range", async () => {
    const load = await withTenantTx(DEPT_CS, (tx) =>
      workloadIn(tx, DEPT_CS, personId, {
        from: at("2026-03-01T00:00:00Z"),
        to: at("2026-03-08T00:00:00Z"),
      }),
    );
    expect(load.hoursByKind.teaching).toBe(2);
    expect(load.totalHours).toBeGreaterThanOrEqual(2);
  });
});
