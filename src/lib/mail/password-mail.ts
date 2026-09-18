import { createElement } from "react";
import { ResetPasswordEmail } from "@/emails/ResetPassword";
import { SetPasswordEmail } from "@/emails/SetPassword";
import { renderEmail } from "./render";
import { sendMail } from "./transport";

export type PasswordMailKind = "set" | "reset";

export interface PasswordMailInput {
  to: string;
  name?: string | null;
  url: string;
  kind?: PasswordMailKind;
}

/** Renders and sends the set-password (new account) or reset-password mail. */
export async function sendPasswordMail(input: PasswordMailInput) {
  const kind: PasswordMailKind =
    input.kind ?? (input.url.includes("set-password") ? "set" : "reset");
  const element =
    kind === "set"
      ? createElement(SetPasswordEmail, { name: input.name, url: input.url })
      : createElement(ResetPasswordEmail, { name: input.name, url: input.url });
  const { html, text } = await renderEmail(element);
  return sendMail({
    to: input.to,
    subject: kind === "set" ? "Set your DeptTS password" : "Reset your DeptTS password",
    html,
    text,
  });
}
