import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecordDetail } from "@/components/feature/RecordDetail";
import type { AvailableAction } from "@/platform/workflow/engine";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const actions: AvailableAction[] = [
  {
    transitionKey: "in_progress.submit",
    action: "submit",
    to: "submitted",
    system: false,
    requiredComment: false,
    requiredFields: [],
    requiredAttachments: [],
    enabled: false,
    // allowed to submit, but not until the deliverable is there
    actorAllowed: true,
    disabledReason: "Missing required deliverable(s): Final report",
  },
  {
    transitionKey: "in_progress.cancel",
    action: "cancel",
    to: "cancelled",
    system: false,
    requiredComment: true,
    requiredFields: [],
    requiredAttachments: [],
    enabled: true,
    actorAllowed: true,
  },
];

function renderDetail(over: Partial<React.ComponentProps<typeof RecordDetail>> = {}) {
  const onAct = vi.fn(async () => ({ ok: true as const, data: {} }));
  render(
    <RecordDetail
      dept="cs"
      title="Prepare the exam paper"
      description="Upload the paper and the marking guide."
      state={{ key: "in_progress", label: "In progress", category: "active" }}
      overdue
      dueLabel="due 2026-09-25"
      fields={[
        { key: "kind", label: "Kind", value: "instructor_task", badge: true },
        { key: "empty", label: "Nothing", value: "" },
      ]}
      steps={[
        { key: "assigned", label: "Assigned", status: "done", at: "2026-09-21T09:00:00.000Z" },
        { key: "in_progress", label: "In progress", status: "current" },
        { key: "completed", label: "Completed", status: "pending" },
      ]}
      actions={actions}
      onAct={onAct}
      slots={[
        {
          slotKey: "paper",
          label: "Examination paper",
          required: true,
          satisfied: true,
          documentId: "d1",
        },
        { slotKey: "guide", label: "Marking guide", satisfied: false },
      ]}
      slotSubject={{ subjectType: "task", subjectId: "t1" }}
      canUploadSlots
      acknowledgements={[
        {
          personId: "p1",
          name: "Instructor One",
          role: "responsible",
          status: "acknowledged",
          at: "2026-09-21T10:00:00.000Z",
        },
        {
          personId: "p2",
          name: "Instructor Two",
          via: "CS instructors",
          status: "declined",
          reason: "on leave",
        },
      ]}
      {...over}
    />,
  );
  return onAct;
}

describe("RecordDetail", () => {
  it("shows the state, the deadline and only the fields that have a value", () => {
    renderDetail();
    expect(
      screen.getByRole("heading", { level: 1, name: "Prepare the exam paper" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("state-badge")).toHaveTextContent("In progress");
    expect(screen.getByTestId("due-badge")).toHaveTextContent("due 2026-09-25");
    expect(screen.getByTestId("field-renderer")).toHaveTextContent("instructor_task");
    expect(screen.queryByText("Nothing")).not.toBeInTheDocument();
  });

  it("renders the step timeline with the current step marked", () => {
    renderDetail();
    const timeline = screen.getByTestId("step-timeline");
    expect(timeline).toHaveTextContent("Assigned");
    expect(screen.getByTestId("step-in_progress")).toHaveAttribute("data-status", "current");
    expect(screen.getByTestId("step-completed")).toHaveAttribute("data-status", "pending");
  });

  it("disables an action that a guard blocks and explains why", async () => {
    const user = userEvent.setup();
    const onAct = renderDetail();
    const submit = screen.getByRole("button", { name: "submit" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("title", "Missing required deliverable(s): Final report");
    await user.click(screen.getByRole("button", { name: "cancel" }));
    expect(onAct).not.toHaveBeenCalled(); // a comment is required first
    expect(screen.getByLabelText(/Comment/)).toBeInTheDocument();
  });

  it("shows the deliverable slots and the acknowledgements in their tabs", async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole("tab", { name: "Deliverables" }));
    expect(screen.getByTestId("slot-paper")).toHaveAttribute("data-satisfied", "true");
    expect(screen.getByTestId("slot-guide")).toHaveAttribute("data-satisfied", "false");
    await user.click(screen.getByRole("tab", { name: "Acknowledgements" }));
    const acks = screen.getByTestId("acknowledgements");
    expect(acks).toHaveTextContent("Instructor One");
    expect(acks).toHaveTextContent("acknowledged");
    expect(acks).toHaveTextContent("via CS instructors");
    expect(acks).toHaveTextContent("declined");
  });
});
