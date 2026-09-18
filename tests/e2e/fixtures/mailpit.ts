export interface Mail {
  id: string;
  subject: string;
  text: string;
  html: string;
  links: string[];
}

function mailpitUrl(): string {
  const url = process.env.MAILPIT_URL;
  if (!url) throw new Error("MAILPIT_URL is not set");
  return url;
}

/** Polls Mailpit until a message addressed to `to` (optionally matching the subject) arrives. */
export async function waitForMail(opts: {
  to: string;
  subjectIncludes?: string;
  timeoutMs?: number;
}): Promise<Mail> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  const query = encodeURIComponent(`to:"${opts.to}"`);
  while (Date.now() < deadline) {
    const res = await fetch(`${mailpitUrl()}/api/v1/search?query=${query}`);
    if (res.ok) {
      const body = (await res.json()) as { messages: Array<{ ID: string; Subject: string }> };
      const hit = body.messages.find(
        (m) => !opts.subjectIncludes || m.Subject.includes(opts.subjectIncludes),
      );
      if (hit) {
        const full = (await (await fetch(`${mailpitUrl()}/api/v1/message/${hit.ID}`)).json()) as {
          ID: string;
          Subject: string;
          Text: string;
          HTML: string;
        };
        const links = Array.from(
          (full.Text + " " + full.HTML).matchAll(/https?:\/\/[^\s"'<>]+/g),
        ).map((m) => m[0]);
        return { id: full.ID, subject: full.Subject, text: full.Text, html: full.HTML, links };
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `no mail for ${opts.to}${opts.subjectIncludes ? ` with subject containing "${opts.subjectIncludes}"` : ""}`,
  );
}

export async function purgeMail(): Promise<void> {
  await fetch(`${mailpitUrl()}/api/v1/messages`, { method: "DELETE" });
}
