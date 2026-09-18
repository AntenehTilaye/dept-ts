import nodemailer, { type Transporter } from "nodemailer";

// One SMTP transport per process from SMTP_URL (Mailpit in dev/e2e, a relay in production).
let transporter: Transporter | undefined;

export function mailTransport(): Transporter {
  if (!transporter) {
    const url = process.env.SMTP_URL;
    if (!url) throw new Error("SMTP_URL is not set");
    transporter = nodemailer.createTransport(url);
  }
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendMail(message: MailMessage): Promise<{ messageId: string }> {
  const info = await mailTransport().sendMail({
    from: process.env.MAIL_FROM ?? "DeptTS <noreply@deptts.local>",
    ...message,
  });
  return { messageId: info.messageId };
}
