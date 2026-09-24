import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { dispatchPending } from "@/platform/audit/outbox";
import { upsertResource } from "@/platform/academic/resources";
import { assignTeaching } from "@/platform/academic/teaching";
import { upsertTimetableSlots } from "@/platform/academic/timetable";
import { materialiseRecurring } from "@/platform/availability";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

let teacherId: string;
let roomId: string;
let sectionOfferingId: string;
let termId: string;

beforeAll(async () => {
  await withDept(DEPT_CS, async (tx) => {
    const teacher = await f.staff(tx, DEPT_CS);
    const section = await f.section(tx, DEPT_CS);
    const { offering, sectionOfferings } = await f.offering(tx, DEPT_CS, {
      sectionIds: [section.id],
    });
    const so = sectionOfferings[0]!;
    const assignment = await assignTeaching(tx, DEPT_CS, {
      sectionOfferingId: so.id,
      personId: teacher.id,
      role: "lecture",
    });
    const room = await upsertResource(tx, DEPT_CS, {
      code: `R-${f.uniqueSuffix()}`,
      name: "Room B12",
      kind: "classroom",
    });
    teacherId = teacher.id;
    roomId = room.id;
    sectionOfferingId = so.id;
    termId = offering.termId;

    await upsertTimetableSlots(tx, DEPT_CS, termId, [
      {
        sectionOfferingId: so.id,
        teachingAssignmentId: assignment.id,
        resourceId: room.id,
        weekday: 2,
        startTime: "09:00",
        endTime: "11:00",
      },
    ]);
  });
  await dispatchPending(100);
});

const blocksOfOffering = () =>
  migratorDb.availabilityBlock.findMany({
    where: { sourceType: "section_offering", sourceId: sectionOfferingId },
    orderBy: { ownerType: "asc" },
  });

describe("the timetable feed", () => {
  it("a class makes its instructor and its room busy, every week of the term", async () => {
    const blocks = await blocksOfOffering();
    expect(blocks.map((b) => [b.ownerType, b.ownerId])).toEqual([
      ["person", teacherId],
      ["resource", roomId],
    ]);
    for (const block of blocks) {
      expect(block.kind).toBe("teaching");
      expect(block.severity).toBe("hard");
      expect(block.weekday).toBe(2);
      expect(block.termId).toBe(termId);
      // the template carries the time of day in the department's clock (Addis Ababa is UTC+3),
      // and the weeks come from the term
      expect(block.startAt.toISOString().slice(11, 16)).toBe("06:00");
      expect(block.endAt.toISOString().slice(11, 16)).toBe("08:00");
    }
  });

  it("changing the timetable replaces the blocks it wrote rather than adding to them", async () => {
    await withTenantTx(DEPT_CS, (tx) =>
      upsertTimetableSlots(tx, DEPT_CS, termId, [
        { sectionOfferingId, weekday: 4, startTime: "14:00", endTime: "16:00" },
      ]),
    );
    await dispatchPending(100);
    const blocks = await blocksOfOffering();
    // the new slot names no instructor and no room, so the offering holds nothing busy any more
    expect(blocks).toEqual([]);
  });

  it("materialising a term writes the concrete weeks a template stands for", async () => {
    await withTenantTx(DEPT_CS, async (tx) => {
      const assignment = await tx.teachingAssignment.findFirstOrThrow({
        where: { sectionOfferingId },
      });
      await upsertTimetableSlots(tx, DEPT_CS, termId, [
        {
          sectionOfferingId,
          teachingAssignmentId: assignment.id,
          weekday: 2,
          startTime: "09:00",
          endTime: "11:00",
        },
      ]);
    });
    await dispatchPending(100);

    const written = await withTenantTx(DEPT_CS, (tx) =>
      materialiseRecurring(tx, DEPT_CS, termId),
    );
    expect(written).toBeGreaterThan(10); // a semester of Tuesdays

    const template = await migratorDb.availabilityBlock.findFirstOrThrow({
      where: { sourceType: "section_offering", sourceId: sectionOfferingId, weekday: 2 },
    });
    const concrete = await migratorDb.availabilityBlock.findMany({
      where: { sourceType: "availability_block", sourceId: template.id },
      orderBy: { startAt: "asc" },
    });
    expect(concrete).toHaveLength(written);
    expect(concrete.every((c) => c.weekday === null)).toBe(true);
    expect(new Date(concrete[0]!.startAt).getUTCDay()).toBe(2); // Tuesday

    // running it again replaces the same rows instead of doubling them
    const again = await withTenantTx(DEPT_CS, (tx) => materialiseRecurring(tx, DEPT_CS, termId));
    expect(again).toBe(written);
    expect(
      await migratorDb.availabilityBlock.count({
        where: { sourceType: "availability_block", sourceId: template.id },
      }),
    ).toBe(written);
  });
});
