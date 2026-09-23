import { expect, test } from "./fixtures/auth";
import { e2eDb } from "./fixtures/db";
import { waitForMail } from "./fixtures/mailpit";

test.describe("forms and public campaign links", () => {
  test.setTimeout(150_000);

  test("the administrator adds a question, publishes v2 and the preview renders it", async ({
    pageAs,
  }) => {
    const admin = await pageAs("admin");
    await admin.goto("/admin/forms");
    await expect(admin.getByTestId("form-appointment_request")).toBeVisible();
    await admin.getByTestId("form-demo_survey").getByRole("link").click();
    await expect(admin.getByTestId("question-list")).toContainText("delivery mode");

    const stamp = Date.now().toString().slice(-4);
    const label = `How reachable is the department office? ${stamp}`;
    // typing into the editor before React has taken over inserts at the caret instead of
    // replacing the document, so wait for the component to report itself hydrated
    const editor = admin.getByLabel("Questions (JSON)");
    await expect(editor).toHaveAttribute("data-hydrated", "true");
    const json = await editor.inputValue();
    const fields = JSON.parse(json) as Array<Record<string, unknown>>;
    fields.push({
      key: `reach_${stamp}`,
      type: "likert",
      label,
      aggregation: "mean",
      sourceBinding: "none",
      constraints: { required: true, min: 1, max: 5 },
    });
    await editor.fill(JSON.stringify(fields, null, 2));
    await admin.getByRole("button", { name: "Save new version" }).click();
    // the message appears twice: the form's live region and the toast
    await expect(admin.getByText("Version saved.").first()).toBeVisible();

    // the new version is published and its preview renders the added question
    await admin.goto("/admin/forms");
    await expect(admin.getByTestId("form-demo_survey")).toContainText("v2 published");
    await admin.getByTestId("form-demo_survey").getByRole("link").click();
    await expect(admin.getByTestId("question-list")).toContainText(label);
    await expect(admin.getByTestId("form-preview")).toContainText(label);
  });

  test("an invited instructor submits the anonymous survey from the mailed link without signing in", async ({
    browser,
    pageAs,
  }) => {
    // the invitation was mailed by the demo seed
    const mail = await waitForMail({
      to: "instructor1.cs@deptts.local",
      subjectIncludes: "Teaching support survey",
      timeoutMs: 60_000,
    });
    const link = /https?:\/\/[^\s"]*\/c\/[A-Za-z0-9_-]+/.exec(mail.text)?.[0];
    expect(link, "the invitation mail carries a token link").toBeTruthy();
    const path = new URL(link!).pathname;

    // a fresh context: no session, no cookies
    const anonymous = await browser.newContext();
    const page = await anonymous.newPage();
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Teaching support survey" })).toBeVisible();
    await expect(page.getByText(/Anonymous/)).toBeVisible();

    await page.getByRole("radio", { name: "4" }).click();
    await page
      .getByLabel("Which delivery mode works best for your courses?")
      .selectOption("blended");
    await page.getByRole("button", { name: "Rank Teaching assistants" }).click();
    await page.getByRole("button", { name: "Rank Laboratory equipment" }).click();
    await page.getByRole("button", { name: "Rank Room allocation" }).click();
    await page
      .getByLabel("Anything else the department should know?")
      .fill("More lab slots please");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByTestId("submitted")).toContainText("anonymously");

    // the single-use token is refused the second time
    await page.goto(path);
    await expect(page.getByTestId("link-refused")).toContainText("already been used");
    await anonymous.close();

    // an unknown token says only that the link is not valid
    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto("/c/not-a-real-token-value-0123456789");
    await expect(strangerPage.getByTestId("link-unknown")).toContainText("not valid");
    await stranger.close();

    // the head sees the participation and the suppressed cells on the results page
    const campaign = await e2eDb().campaign.findFirstOrThrow({
      where: { title: "Teaching support survey" },
    });
    const dh = await pageAs("dh.cs");
    await dh.goto(`/d/cs/campaigns/${campaign.id}/results`);
    await expect(dh.getByRole("heading", { name: "Teaching support survey" })).toBeVisible();
    await expect(dh.getByText("Invited")).toBeVisible();
    await dh.getByRole("button", { name: "Recompute" }).click();
    await expect(dh.getByText(/Recomputed \d+ cells/)).toBeVisible();
    // one response against the seeded threshold of 5 keeps every cell suppressed
    await expect(dh.getByTestId("result-support")).toHaveAttribute("data-suppressed", "true");
    await expect(dh.getByTestId("result-support")).toContainText("suppressed");
  });
});
