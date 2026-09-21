import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { dispatchPending } from "@/platform/audit/outbox";
import type { Actor } from "@/platform/identity/can";
import {
  close,
  escalate,
  EscalationTargetNotRegistered,
  extractMentions,
  getOrCreateThread,
  list,
  openConversation,
  post,
  segmentMentions,
  stripMentions,
  ThreadAccessError,
  ThreadClosedError,
} from "@/platform/thread";
import { subjectDeleted } from "@/platform/subject-registry";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

let instructor: Actor;
let colleague: Actor;
let head: Actor;
let headPersonId: string;
let personId: string;

async function actorFor(email: string, personId: string | null): Promise<Actor> {
  const user = await migratorDb.user.findUniqueOrThrow({ where: { email } });
  return { userId: user.id, personId, departmentId: DEPT_CS, isAdmin: user.role === "admin" };
}

beforeAll(async () => {
  const users = await migratorDb.user.findMany({
    where: {
      email: {
        in: ["instructor1.cs@deptts.local", "instructor2.cs@deptts.local", "dh.cs@deptts.local"],
      },
    },
  });
  const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));
  const mk = (email: string) =>
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS, { userId: byEmail[email]!.id, email }));
  const [p1, p2, dh] = await Promise.all([
    mk("instructor1.cs@deptts.local"),
    mk("instructor2.cs@deptts.local"),
    mk("dh.cs@deptts.local"),
  ]);
  personId = p1.id;
  headPersonId = dh.id;
  instructor = await actorFor("instructor1.cs@deptts.local", p1.id);
  colleague = await actorFor("instructor2.cs@deptts.local", p2.id);
  head = await actorFor("dh.cs@deptts.local", dh.id);
});

const me = () => ({ subjectType: "person", subjectId: personId });

describe("threads and comments", () => {
  it("parses, strips and segments mention markup", () => {
    const body =
      "Ping @[Dr. Hanna Bekele](person:cmu6xqsgd0000abcd) and @[Dr. Hanna Bekele](person:cmu6xqsgd0000abcd) again";
    expect(extractMentions(body)).toEqual([
      { name: "Dr. Hanna Bekele", personId: "cmu6xqsgd0000abcd" },
    ]);
    expect(stripMentions(body)).toBe("Ping @Dr. Hanna Bekele and @Dr. Hanna Bekele again");
    expect(segmentMentions("hi @[A B](person:cmu6xqsgd0000abcd)!").map((s) => s.type)).toEqual([
      "text",
      "mention",
      "text",
    ]);
  });

  it("getOrCreateThread is idempotent per subject and kind, and a mention notifies after dispatch", async () => {
    const t1 = await withTenantTx(DEPT_CS, (tx) =>
      getOrCreateThread(tx, DEPT_CS, me(), "comments", instructor.userId),
    );
    const t2 = await withTenantTx(DEPT_CS, (tx) =>
      getOrCreateThread(tx, DEPT_CS, me(), "comments", head.userId),
    );
    expect(t2.id).toBe(t1.id);
    const notes = await withTenantTx(DEPT_CS, (tx) =>
      getOrCreateThread(tx, DEPT_CS, me(), "revision_notes", head.userId),
    );
    expect(notes.id).not.toBe(t1.id);

    const dhName = "Dr. Hanna Bekele";
    const comment = await withTenantTx(DEPT_CS, (tx) =>
      post(tx, instructor, {
        threadId: t1.id,
        body: `Could you review my CV, @[${dhName}](person:${headPersonId})? Also @[me](person:${personId}) and @[nobody](person:cmu6xqsgd0000zzzz).`,
      }),
    );
    // the author and unknown persons are not mentioned; the head is
    expect(comment.mentions).toEqual([headPersonId]);
    await dispatchPending(100);
    const n = await migratorDb.notification.findUnique({
      where: { dedupeKey: `mention:${comment.id}:${headPersonId}` },
    });
    expect(n).toMatchObject({ category: "mention", recipientPersonId: headPersonId });
    expect(n!.body).toContain("mentioned you");
    expect(n!.actionUrl).toBe(`/d/cs/people/${personId}`);
  });

  it("reviewer-only notes are hidden from non-reviewers; uninvolved actors cannot read; closed threads refuse posts", async () => {
    const t = await withTenantTx(DEPT_CS, (tx) =>
      getOrCreateThread(tx, DEPT_CS, me(), "revision_notes", head.userId),
    );
    await withTenantTx(DEPT_CS, (tx) =>
      post(tx, head, { threadId: t.id, body: "For reviewers", visibility: "reviewers_only" }),
    );
    await withTenantTx(DEPT_CS, (tx) => post(tx, head, { threadId: t.id, body: "For everyone" }));
    await expect(
      withTenantTx(DEPT_CS, (tx) =>
        post(tx, instructor, { threadId: t.id, body: "sneaky", visibility: "reviewers_only" }),
      ),
    ).rejects.toBeInstanceOf(ThreadAccessError);
    const seenByOwner = await withTenantTx(DEPT_CS, (tx) => list(tx, instructor, t.id));
    expect(seenByOwner.map((c) => c.body)).toEqual(["For everyone"]);
    const seenByHead = await withTenantTx(DEPT_CS, (tx) => list(tx, head, t.id));
    expect(seenByHead.map((c) => c.body)).toEqual(["For reviewers", "For everyone"]);
    await expect(withTenantTx(DEPT_CS, (tx) => list(tx, colleague, t.id))).rejects.toBeInstanceOf(
      ThreadAccessError,
    );
    await withTenantTx(DEPT_CS, (tx) => close(tx, head, t.id));
    await expect(
      withTenantTx(DEPT_CS, (tx) => post(tx, instructor, { threadId: t.id, body: "late" })),
    ).rejects.toBeInstanceOf(ThreadClosedError);
  });

  it("conversations are private to their participants", async () => {
    const conv = await withTenantTx(DEPT_CS, (tx) =>
      openConversation(tx, instructor, {
        title: "About the lab",
        participantPersonIds: [headPersonId],
      }),
    );
    expect(conv.kind).toBe("conversation");
    await withTenantTx(DEPT_CS, (tx) => post(tx, head, { threadId: conv.id, body: "Sure" }));
    const seen = await withTenantTx(DEPT_CS, (tx) => list(tx, instructor, conv.id));
    expect(seen).toHaveLength(1);
    await expect(
      withTenantTx(DEPT_CS, (tx) => post(tx, colleague, { threadId: conv.id, body: "hey" })),
    ).rejects.toBeInstanceOf(ThreadAccessError);
  });

  it("escalation fails until a target is registered, and a deleted subject closes its threads", async () => {
    const t = await withTenantTx(DEPT_CS, (tx) =>
      getOrCreateThread(tx, DEPT_CS, me(), "comments", instructor.userId),
    );
    await expect(
      withTenantTx(DEPT_CS, (tx) => escalate(tx, head, t.id, { title: "x", issue: "y" })),
    ).rejects.toBeInstanceOf(EscalationTargetNotRegistered);
    const p = await withDept(DEPT_CS, (tx) => f.person(tx, DEPT_CS));
    const ref = { subjectType: "person", subjectId: p.id };
    const tp = await withTenantTx(DEPT_CS, (tx) =>
      getOrCreateThread(tx, DEPT_CS, ref, "comments", head.userId),
    );
    await withTenantTx(DEPT_CS, (tx) => subjectDeleted(tx, ref));
    expect((await migratorDb.thread.findUniqueOrThrow({ where: { id: tp.id } })).status).toBe(
      "closed",
    );
  });
});
