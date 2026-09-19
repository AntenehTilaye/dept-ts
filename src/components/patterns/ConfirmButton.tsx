"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions/safe-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ButtonProps = React.ComponentProps<typeof Button>;

/** A button that asks for confirmation before running a server action (destructive or irreversible steps). */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "destructive",
  size = "sm",
  action,
  successMessage = "Done.",
}: {
  label: string;
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  action: () => Promise<ActionResult<unknown>>;
  successMessage?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await action();
      if (r.ok) {
        toast.success(successMessage);
        setOpen(false);
      } else toast.error(r.message);
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant={variant} disabled={pending} onClick={run}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
