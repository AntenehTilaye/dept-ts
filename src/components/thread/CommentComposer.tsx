"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import {
  mentionCandidatesAction,
  postCommentAction,
} from "@/app/(app)/d/[dept]/(modules)/documents/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Candidate {
  id: string;
  name: string;
  email: string | null;
}

/**
 * Textarea with an @mention picker: typing "@" plus letters searches the department directory;
 * choosing a person inserts `@[Name](person:id)` which the panel renders as a chip.
 */
export function CommentComposer({
  dept,
  subject,
  kind = "comments",
  path,
  canReviewerNotes,
  onPosted,
}: {
  dept: string;
  subject: { subjectType: string; subjectId: string };
  kind?: "comments" | "revision_notes";
  path?: string;
  canReviewerNotes?: boolean;
  onPosted?: () => void;
}) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"all" | "reviewers_only" | "internal">("all");
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [found, setFound] = useState<{ q: string; items: Candidate[] } | null>(null);
  const candidates = query && found?.q === query.text ? found.items : [];
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  // detect "@word" before the caret
  function onChange(next: string) {
    setBody(next);
    const caret = areaRef.current?.selectionStart ?? next.length;
    const before = next.slice(0, caret);
    const m = /(^|\s)@([^\s@\]()]{1,40})$/.exec(before);
    if (m) setQuery({ text: m[2]!, start: caret - m[2]!.length - 1 });
    else setQuery(null);
  }

  // candidates are keyed by the query that produced them; a cleared query shows none
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      mentionCandidatesAction({ dept, q: query.text }).then((r) => {
        if (!cancelled && r.ok) {
          setFound({ q: query.text, items: r.data });
          setActive(0);
        }
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [dept, query]);

  function pick(c: Candidate) {
    if (!query) return;
    const caret = areaRef.current?.selectionStart ?? body.length;
    const markup = `@[${c.name}](person:${c.id}) `;
    const next = body.slice(0, query.start) + markup + body.slice(caret);
    setBody(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      const pos = query.start + markup.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function submit() {
    if (!body.trim()) return;
    start(async () => {
      const r = await postCommentAction({ dept, ...subject, kind, body, visibility, path });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setBody("");
      toast.success("Comment posted");
      onPosted?.();
    });
  }

  return (
    <form
      className="relative flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      data-testid="comment-composer"
    >
      <Label htmlFor={`${listId}-body`} className="sr-only">
        Comment
      </Label>
      <Textarea
        ref={areaRef}
        id={`${listId}-body`}
        value={body}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write a comment… type @ to mention someone"
        rows={3}
        aria-autocomplete="list"
        aria-controls={query ? listId : undefined}
        aria-expanded={!!query && candidates.length > 0}
        onKeyDown={(e) => {
          if (query && candidates.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % candidates.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + candidates.length) % candidates.length);
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(candidates[active]!);
            } else if (e.key === "Escape") {
              setQuery(null);
            }
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {query && candidates.length ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="People"
          className="absolute top-full left-0 z-20 mt-1 w-72 rounded-md border bg-popover p-1 text-sm shadow-md"
        >
          {candidates.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              className={cn(
                "cursor-pointer rounded-sm px-2 py-1.5",
                i === active ? "bg-accent text-accent-foreground" : "",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="font-medium">{c.name}</span>
              {c.email ? (
                <span className="ml-2 text-xs text-muted-foreground">{c.email}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canReviewerNotes ? (
          <div className="flex items-center gap-2">
            <Label htmlFor={`${listId}-vis`} className="text-xs text-muted-foreground">
              Visible to
            </Label>
            <NativeSelect
              id={`${listId}-vis`}
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as typeof visibility)}
              className="h-8 w-auto text-xs"
            >
              <option value="all">everyone involved</option>
              <option value="internal">staff only</option>
              <option value="reviewers_only">reviewers only</option>
            </NativeSelect>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Ctrl/⌘ + Enter to post</span>
        )}
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          <SendIcon /> {pending ? "Posting…" : "Post comment"}
        </Button>
      </div>
    </form>
  );
}
