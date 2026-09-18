import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "@/lib/db/tenant";
import { enqueue } from "@/platform/scheduler/enqueue";
import emailDead from "../../apps/worker/src/handlers/email-dead";
import emailSend from "../../apps/worker/src/handlers/email-send";
import { DEPT_CS } from "../setup/seed-minimal";
import { uniqueSuffix } from "../setup/factories";
import { awaitJob, startTestBoss } from "../setup/boss";

let boss: PgBoss;
beforeAll(async () => {
  boss = await startTestBoss([emailSend, emailDead]);
});
afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
});

async function mailpit(path: string) {
  const res = await fetch(`${process.env.MAILPIT_URL}${path}`);
  return res.json() as Promise<{
    messages: Array<{ ID: string; Subject: string }>;
    messages_count: number;
  }>;
}

describe("email.send worker", () => {
  it("delivers to Mailpit with subject and body visible through the API", async () => {
    const to = `worker.${uniqueSuffix()}@deptts.local`;
    const { jobId } = await withTenantTx(DEPT_CS, (tx) =>
      enqueue(
        tx,
        "email.send",
        { message: { to, subject: "Worker hello", text: "Body line\n\nhttps://example.org" } },
        { kind: "reminder", departmentId: DEPT_CS },
      ),
    );
    const job = await awaitJob(boss, "email.send", jobId!);
    expect(job.state).toBe("completed");
    const found = await mailpit(`/api/v1/search?query=to:${encodeURIComponent(to)}`);
    expect(found.messages_count).toBe(1);
    expect(found.messages[0]!.Subject).toBe("Worker hello");
    const full = (await (
      await fetch(`${process.env.MAILPIT_URL}/api/v1/message/${found.messages[0]!.ID}`)
    ).json()) as { Text: string; HTML: string };
    expect(full.Text).toContain("Body line");
    expect(full.HTML).toContain('href="https://example.org"');
  });

  it("a transport failure retries and finally dead-letters with an admin alert", async () => {
    const { migratorDb, withDept } = await import("../setup/db");
    const f = await import("../setup/factories");
    const head = await migratorDb.user.findUniqueOrThrow({
      where: { email: "dh.cs@deptts.local" },
    });
    await withDept(DEPT_CS, (tx) =>
      f.staff(tx, DEPT_CS, { userId: head.id, email: "dh.cs@deptts.local" }),
    );
    const original = process.env.SMTP_URL;
    // an unroutable SMTP target makes nodemailer fail fast for every attempt
    const { mailTransport } = await import("@/lib/mail/transport");
    const transport = mailTransport();
    const realSend = transport.sendMail.bind(transport);
    let attempts = 0;
    (transport as { sendMail: unknown }).sendMail = async () => {
      attempts++;
      throw new Error("smtp down");
    };
    try {
      const { jobId } = await withTenantTx(DEPT_CS, (tx) =>
        enqueue(
          tx,
          "email.send",
          {
            departmentId: DEPT_CS,
            message: { to: "x@deptts.local", subject: "Doomed", text: "x" },
          },
          { kind: "reminder", departmentId: DEPT_CS, retryLimit: 1 },
        ),
      );
      const job = await awaitJob(boss, "email.send", jobId!, 30_000);
      expect(job.state).toBe("failed");
      expect(attempts).toBeGreaterThanOrEqual(2);
      // the dead-letter handler alerts the department head in-app
      const deadline = Date.now() + 15_000;
      let alert = null;
      while (Date.now() < deadline && !alert) {
        alert = await migratorDb.notification.findFirst({
          where: { category: "system_alert", body: { contains: "Doomed" } },
        });
        if (!alert) await new Promise((r) => setTimeout(r, 250));
      }
      expect(alert?.title).toBe("Email delivery failed");
    } finally {
      (transport as { sendMail: unknown }).sendMail = realSend;
      process.env.SMTP_URL = original;
    }
  });
});
