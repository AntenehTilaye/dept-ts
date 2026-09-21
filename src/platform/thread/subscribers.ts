import { globalSingleton } from "../../lib/singleton";
import { subscribe } from "../audit/outbox";
import { notify } from "../scheduler/notify";
import { isRegistered, label, url } from "../subject-registry";
import { stripMentions } from "./mentions";

// comment.posted -> one `mention` notification per mentioned person (dedupe per comment).

const state = globalSingleton("thread-subscribers", () => ({ installed: false }));

interface CommentPosted {
  commentId: string;
  threadId: string;
  authorPersonId: string;
  mentions: string[];
  subject: { subjectType: string; subjectId: string } | null;
}

export function installThreadSubscribers(): void {
  if (state.installed) return;
  state.installed = true;
  subscribe("comment.posted", "thread.mentions", async (e, tx) => {
    const p = e.payloadJson as CommentPosted | null;
    if (!e.departmentId || !p?.mentions?.length) return;
    const [comment, author, department] = await Promise.all([
      tx.comment.findUnique({ where: { id: p.commentId } }),
      tx.person.findUnique({ where: { id: p.authorPersonId }, select: { fullName: true } }),
      tx.department.findUnique({ where: { id: e.departmentId }, select: { code: true } }),
    ]);
    if (!comment) return;
    const slug = department?.code.toLowerCase() ?? "";
    const subject =
      p.subject && isRegistered(p.subject.subjectType)
        ? p.subject
        : { subjectType: "thread", subjectId: p.threadId };
    const actionUrl = url(subject, slug) ?? `/d/${slug}/inbox`;
    await notify(tx, e.departmentId, {
      recipients: p.mentions,
      templateKey: "mention",
      category: "mention",
      subject,
      actionUrl,
      dedupeKey: `mention:${p.commentId}`,
      variables: {
        author_name: author?.fullName ?? "Someone",
        comment: stripMentions(comment.body),
        subject_label: await label(tx, subject).catch(() => subject.subjectId),
      },
    });
  });
}
