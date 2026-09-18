"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** New-password form for the set-password (new account) and reset-password flows. */
export function NewPasswordForm({ token, mode }: { token: string; mode: "set" | "reset" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError("The two passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (err) {
      setError(err.message ?? "The link is invalid or has expired.");
      return;
    }
    router.push("/login?set=1");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div className="grid gap-2">
        <Label htmlFor="password">{mode === "set" ? "Choose a password" : "New password"}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
        <p className="text-xs text-muted-foreground">At least 10 characters.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : mode === "set" ? "Set password" : "Reset password"}
      </Button>
    </form>
  );
}

/** Requests a reset mail. */
export function RequestResetForm() {
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    await authClient.requestPasswordReset({
      email: String(form.get("email") ?? ""),
      redirectTo: "/reset-password",
    });
    setPending(false);
    setDone(true);
  }

  if (done)
    return (
      <Alert variant="success">If that address has an account, a reset link is on its way.</Alert>
    );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
