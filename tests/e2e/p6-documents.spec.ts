import { createHmac } from "node:crypto";
import { expect, test } from "./fixtures/auth";

// The dev/e2e stacks share the compose default secret unless the host overrides it.
const SECRET = process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-please-change-0123456789";
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

function signedPath(documentId: string, versionNo: number, userId: string, exp: number): string {
  const payload = Buffer.from(
    JSON.stringify([documentId, versionNo, "dep_cs", userId, exp]),
  ).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `/api/documents/${documentId}/v/${versionNo}/download?t=${encodeURIComponent(`${payload}.${sig}`)}`;
}

test.describe("documents and discussion", () => {
  test.setTimeout(120_000);

  test("an instructor uploads evidence on their page, downloads it, adds a version, mentions the head, who sees it in the inbox", async ({
    pageAs,
  }) => {
    const page = await pageAs("instructor1.cs");
    await page.goto("/d/cs/people?q=Instructor%20One");
    await page.getByTestId("person-instructor1.cs@deptts.local").getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Instructor One" })).toBeVisible();
    const personId = page.url().split("/").pop()!;

    // upload (evidence) from the person page
    const docs = page.getByTestId("person-documents");
    await docs.getByLabel("Upload a file").setInputFiles({
      name: "certificate.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(page.getByText("certificate.pdf uploaded")).toBeVisible();
    const row = docs
      .getByTestId("document-list")
      .locator("li")
      .filter({ hasText: "certificate.pdf" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("PDF");
    await expect(row).toContainText("v1");

    // download through a fresh signed link
    const downloadPromise = page.waitForEvent("download");
    await row.getByRole("button", { name: "Download certificate.pdf" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("certificate.pdf");

    // version history and a second version
    await row.getByRole("button", { name: "Version history of certificate.pdf" }).click();
    const dialog = page.getByTestId("version-history");
    await expect(dialog.getByTestId("version-1")).toContainText("current");
    await dialog.getByLabel("Upload new version").setInputFiles({
      name: "certificate-v2.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(dialog.getByTestId("version-2")).toContainText("current");
    await expect(dialog.getByTestId("version-1")).not.toContainText("current");
    const documentId = (await row.getAttribute("data-testid"))!.replace("document-", "");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("v2");

    // a tampered and an expired link are refused
    const me = await page.evaluate(() => fetch("/api/auth/get-session").then((r) => r.json()));
    const userId = (me as { user: { id: string } }).user.id;
    const stale = await page.request.get(
      signedPath(documentId, 2, userId, Math.floor(Date.now() / 1000) - 60),
    );
    expect(stale.status()).toBe(410);
    const forged = await page.request.get(`/api/documents/${documentId}/v/2/download?t=abc.def`);
    expect(forged.status()).toBe(403);
    const fresh = await page.request.get(
      signedPath(documentId, 2, userId, Math.floor(Date.now() / 1000) + 60),
    );
    expect(fresh.status()).toBe(200);
    expect(fresh.headers()["content-disposition"]).toContain("certificate-v2.pdf");

    // the documents browser lists it under People and under my uploads
    await page.goto("/d/cs/documents?view=person");
    await expect(page.getByTestId(`document-${documentId}`)).toBeVisible();
    await page.goto("/d/cs/documents");
    await expect(page.getByTestId(`document-${documentId}`)).toBeVisible();

    // a comment mentioning the head
    await page.goto(`/d/cs/people/${personId}`);
    const composer = page.getByTestId("comment-composer");
    const area = composer.getByLabel("Comment");
    await area.fill("Please review my certificate @Hanna");
    const option = page.getByRole("option", { name: /Hanna Bekele/ });
    await expect(option).toBeVisible();
    await option.click();
    await expect(area).toHaveValue(/@\[Dr\. Hanna Bekele\]\(person:[a-z0-9]+\) $/);
    await area.press("End");
    await area.type("please.");
    await composer.getByRole("button", { name: "Post comment" }).click();
    const thread = page.getByTestId("thread-panel");
    await expect(thread.getByText("@Dr. Hanna Bekele")).toBeVisible();
    await expect(thread).toContainText("1 comment");

    // the head finds the mention in the inbox once the outbox is dispatched (cron every minute)
    const head = await pageAs("dh.cs");
    await expect
      .poll(
        async () => {
          await head.goto("/d/cs/inbox?filter=unread");
          return head.getByText("mentioned you on Instructor One").count();
        },
        { timeout: 90_000, intervals: [3_000] },
      )
      .toBeGreaterThan(0);
    const item = head.getByTestId("notification-mention").filter({ hasText: "mentioned you" });
    await item.getByRole("link", { name: "Open" }).click();
    await expect(head).toHaveURL(new RegExp(`/d/cs/people/${personId}`));
    await expect(head.getByTestId("thread-panel")).toContainText("Please review my certificate");
  });

  test("an uninvolved instructor cannot upload to a colleague's page but can read the file", async ({
    pageAs,
  }) => {
    const chair = await pageAs("chair.cs");
    await chair.goto("/d/cs/people?q=Instructor%20One");
    await chair.getByTestId("person-instructor1.cs@deptts.local").getByRole("link").click();
    const docs = chair.getByTestId("person-documents");
    await expect(docs.getByLabel("Upload a file")).toHaveCount(0);
    await expect(docs.getByTestId("document-list")).toContainText("certificate.pdf");
    await expect(docs.getByRole("button", { name: /Delete/ })).toHaveCount(0);
  });
});
