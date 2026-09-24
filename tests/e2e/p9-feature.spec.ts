import { expect, test } from "./fixtures/auth";

// The feature builder and the runtime it produces: an administrator inspects a composed process
// and simulates it, and the people it is for then actually run one through the generic pages.

test.describe("the feature builder and the generic runtime", () => {
  test.setTimeout(150_000);

  test("the administrator inspects a built-in feature, validates and simulates it", async ({
    pageAs,
  }) => {
    const admin = await pageAs("admin");
    await admin.goto("/admin/features");
    await expect(admin.getByTestId("feature-task")).toBeVisible();
    await expect(admin.getByTestId("feature-generic_request")).toContainText("published");

    await admin.getByTestId("feature-generic_request").getByRole("link").click();
    await expect(admin.getByTestId("step-tree")).toContainText("Request");
    await expect(admin.getByTestId("step-tree")).toContainText("Deputy review");
    await expect(admin.getByText("Nothing blocks publishing.")).toBeVisible();

    // a system feature says what it will not let an administrator change
    await expect(admin.getByText(/backed by code/)).toBeVisible();

    await admin.getByRole("button", { name: "Run simulation" }).click();
    await expect(admin.getByTestId("simulation-trace")).toContainText("request");
    await expect(admin.getByTestId("simulation-trace")).toContainText("Steps entered");
  });

  test("an instructor files a request, a reviewer endorses it and the head approves", async ({
    pageAs,
  }) => {
    const instructor = await pageAs("instructor1.cs");
    await instructor.goto("/d/cs/f/generic_request/new");
    await instructor.getByLabel("Subject").fill("Second projector for Lab A");
    await instructor
      .getByLabel("Details")
      .fill("The lab has one projector for two parallel sessions.");
    await instructor.getByLabel("Urgency").selectOption("soon");
    await instructor.getByRole("button", { name: /Create request/i }).click();

    // the record page names the record and offers the step it is waiting on
    await expect(instructor.getByRole("heading", { name: "Second projector for Lab A" })).toBeVisible();
    const url = new URL(instructor.url());
    const recordId = url.pathname.split("/").at(-1)!;

    await instructor.goto(`/d/cs/f/generic_request/${recordId}/steps/request`);
    await instructor.getByRole("button", { name: "Submit" }).click();
    await expect(instructor.getByTestId("state-badge")).toHaveText("Review");

    // the deputy head endorses from their branch of the parallel review
    const deputy = await pageAs("dpt.cs");
    await deputy.goto(`/d/cs/f/generic_request/${recordId}/steps/deputy_review?branch=deputy`);
    await deputy.getByRole("button", { name: "Endorse" }).click();
    await expect(deputy.getByTestId("state-badge")).toHaveText("Decision");

    // one endorsement is enough: the record is with the head, and the committee branch is closed
    const head = await pageAs("dh.cs");
    await head.goto(`/d/cs/f/generic_request/${recordId}`);
    await expect(head.getByTestId("state-badge")).toHaveText("Decision");
    await head.goto(`/d/cs/f/generic_request/${recordId}/steps/decision`);
    await head.getByRole("button", { name: "Approve" }).click();
    // acting returns to the record, so the badge is read where the action left the actor
    await head.waitForURL(`**/f/generic_request/${recordId}`);
    await expect(head.getByTestId("state-badge")).toHaveText("Approved");

    await head.goto(`/d/cs/f/generic_request/${recordId}/history`);
    await expect(head.getByText("Steps")).toBeVisible();
    await expect(head.getByText("skipped").first()).toBeVisible();
  });

  test("the request appears in the department's feature list and in the sidebar", async ({
    pageAs,
  }) => {
    const head = await pageAs("dh.cs");
    await head.goto("/d/cs/f/generic_request");
    await expect(head.getByRole("heading", { name: "Requests" })).toBeVisible();
    await expect(head.getByRole("link", { name: "Requests" }).first()).toBeVisible();
  });
});
