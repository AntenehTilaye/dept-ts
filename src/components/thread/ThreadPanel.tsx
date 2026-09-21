"use client";

import { useTransition } from "react";
import { LockIcon, LockOpenIcon, MessageSquareIcon } from "lucide-react";
import { toast } from "sonner";
import { setThreadStatusAction } from "@/app/(app)/d/[dept]/(modules)/documents/actions";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { segmentMentions } from "@/platform/thread/mentions";
import { CommentComposer } from "./CommentComposer";

export interface CommentView {
  id: string;
  authorName: string;
  authorPersonId: string;
  body: string;
  visibility: "all" | "reviewers_only" | "internal";
  createdAt: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function CommentBody({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-line text-sm">
      {segmentMentions(body).map((s, i) =>
        s.type === "text" ? (
          <span key={i}>{s.text}</span>
        ) : (
          <span
            key={i}
            className="rounded bg-primary/10 px-1 font-medium text-primary"
            data-person-id={s.personId}
          >
            @{s.name}
          </span>
        ),
      )}
    </p>
  );
}

/**
 * The discussion of a subject: comments oldest first, the composer at the bottom, and
 * close/reopen for people who may manage it. Server-rendered comments come as plain rows.
 */
export function ThreadPanel({
  dept,
  subject,
  kind = "comments",
  threadId,
  status,
  comments,
  canPost,
  canReviewerNotes,
  canClose,
  path,
}: {
  dept: string;
  subject: { subjectType: string; subjectId: string };
  kind?: "comments" | "revision_notes";
  threadId: string | null;
  status: "open" | "closed";
  comments: CommentView[];
  canPost: boolean;
  canReviewerNotes?: boolean;
  canClose?: boolean;
  path?: string;
}) {
  const [pending, start] = useTransition();
  function setStatus(next: "open" | "closed") {
    if (!threadId) return;
    start(async () => {
      const r = await setThreadStatusAction({ dept, threadId, status: next, path });
      if (!r.ok) toast.error(r.message);
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="thread-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {comments.length} {comments.length === 1 ? "comment" : "comments"}
          {status === "closed" ? " · closed" : ""}
        </p>
        {canClose && threadId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setStatus(status === "open" ? "closed" : "open")}
          >
            {status === "open" ? (
              <>
                <LockIcon /> Close discussion
              </>
            ) : (
              <>
                <LockOpenIcon /> Reopen
              </>
            )}
          </Button>
        ) : null}
      </div>
      {comments.length === 0 ? (
        <EmptyState
          compact
          icon={<MessageSquareIcon />}
          title="No comments yet"
          hint={
            canPost
              ? "Start the discussion below; mention someone with @ to notify them."
              : undefined
          }
        />
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Comments">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3" data-testid={`comment-${c.id}`}>
              <Avatar className="mt-0.5">
                <AvatarFallback>{initials(c.authorName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 rounded-md bg-muted/40 px-3 py-2">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.authorName}</span>
                  <span>{c.createdAt.slice(0, 16).replace("T", " ")}</span>
                  {c.visibility !== "all" ? (
                    <Badge variant="outline">
                      {c.visibility === "reviewers_only" ? "reviewers only" : "staff only"}
                    </Badge>
                  ) : null}
                </p>
                <CommentBody body={c.body} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {canPost && status === "open" ? (
        <CommentComposer
          dept={dept}
          subject={subject}
          kind={kind}
          path={path}
          canReviewerNotes={canReviewerNotes}
        />
      ) : null}
    </div>
  );
}
