import { createElement } from "react";
import { ResetPasswordEmail } from "@/emails/ResetPassword";
import { SetPasswordEmail } from "@/emails/SetPassword";
import { prismaRoot } from "@/lib/db/prisma";
import { renderVariants, resolveTemplate } from "@/platform/template/service";
import { wrapHtml } from "@/platform/scheduler/channels/html";
import { renderEmail } from "./render";
import { sendMail } from "./transport";

export type PasswordMailKind = "set" | "reset";

export interface PasswordMailInput {
  to: string;
  name?: string | null;
  url: string;
  kind?: PasswordMailKind;
}

/**
 * Sends the set-password (new account) or reset-password mail. The seeded `auth.set_password`
 * / `auth.reset_password` templates provide subject and text when present (administrators may
 * edit them); the bundled react-email layout is the fallback before the seed ran.
 */
export async function sendPasswordMail(input: PasswordMailInput) {
  const kind: PasswordMailKind =
    input.kind ?? (input.url.includes("set-password") ? "set" : "reset");
  const template = await resolveTemplate(
    prismaRoot,
    kind === "set" ? "auth.set_password" : "auth.reset_password",
    null,
  ).catch(() => null);
  if (template?.variants.emailBody) {
    const r = renderVariants(
      template,
      { url: input.url, name: input.name ?? "", action_url: input.url },
      ["emailSubject", "emailBody"],
    );
    const subject =
      r.emailSubject ??
      (kind === "set" ? "Set your DeptTS password" : "Reset your DeptTS password");
    return sendMail({
      to: input.to,
      subject,
      text: r.emailBody!,
      html: wrapHtml(subject, r.emailBody!, input.url),
    });
  }
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
