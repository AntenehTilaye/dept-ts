"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export interface UploadLink {
  subjectType: string;
  subjectId: string;
  linkRole?: string;
  slotKey?: string;
}

export const ACCEPT = ".pdf,.png,.jpg,.jpeg,.xlsx,.docx,.csv,.txt,.md";

/**
 * Picks a file and posts it to /api/uploads with progress. Either links a new document to
 * subjects, or (with `documentId`) adds a version to an existing one. Refreshes the route on
 * success so server-rendered lists pick the change up.
 */
export function UploadButton({
  dept,
  links,
  documentId,
  label = "Upload",
  variant = "outline",
  size = "sm",
  title,
  category,
  onUploaded,
}: {
  dept: string;
  links?: UploadLink[];
  documentId?: string;
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  title?: string;
  category?: string;
  onUploaded?: (result: { documentId: string; versionNo: number }) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const id = useId();

  function send(file: File) {
    const form = new FormData();
    form.set("file", file);
    form.set("dept", dept);
    if (documentId) form.set("documentId", documentId);
    else form.set("links", JSON.stringify(links ?? []));
    if (title) form.set("title", title);
    if (category) form.set("category", category);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setProgress(null);
      let body: { documentId?: string; versionNo?: number; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status === 201 && body.documentId && body.versionNo) {
        toast.success(documentId ? `Version ${body.versionNo} uploaded` : `${file.name} uploaded`);
        onUploaded?.({ documentId: body.documentId, versionNo: body.versionNo });
        router.refresh();
      } else {
        toast.error(body.error ?? `Upload failed (${xhr.status})`);
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      toast.error("Upload failed: network error");
    };
    setProgress(0);
    xhr.send(form);
  }

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) send(file);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={progress !== null}
        onClick={() => inputRef.current?.click()}
        aria-busy={progress !== null}
      >
        <UploadIcon />
        {progress === null ? label : `Uploading… ${progress}%`}
      </Button>
    </>
  );
}
