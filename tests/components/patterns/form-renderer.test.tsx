import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { FormRenderer, type Answers } from "@/components/forms/FormRenderer";
import type { FieldDef } from "@/platform/forms/field-schema";

const field = (x: FieldDef): FieldDef => ({ sourceBinding: "none", aggregation: "none", ...x });

const FIELDS: FieldDef[] = [
  field({ key: "part_a", type: "section_header", label: "About the course" }),
  field({
    key: "title",
    type: "short_text",
    label: "Title",
    helpText: "As it appears in the catalogue",
    constraints: { required: true },
  }),
  field({
    key: "score",
    type: "likert",
    label: "Score",
    constraints: { required: true, min: 1, max: 5 },
  }),
  field({
    key: "mode",
    type: "single_choice",
    label: "Mode",
    options: [
      { value: "onsite", label: "On site" },
      { value: "online", label: "Online" },
    ],
  }),
  field({
    key: "topics",
    type: "multi_choice",
    label: "Topics",
    options: [
      { value: "labs", label: "Labs" },
      { value: "tutorials", label: "Tutorials" },
    ],
  }),
  field({
    key: "prefs",
    type: "ranked_list",
    label: "Priorities",
    options: [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ],
  }),
  field({
    key: "items",
    type: "repeating_group",
    label: "Items",
    constraints: { required: false, maxItems: 2 },
    fields: [field({ key: "name", type: "short_text", label: "Name" })],
  }),
  field({
    key: "reason",
    type: "long_text",
    label: "Reason",
    constraints: { required: true, visibleIf: { field: "mode", equals: ["online"] } },
  }),
];

function Harness({ issues }: { issues?: Record<string, string[]> }) {
  const [answers, setAnswers] = useState<Answers>({});
  return (
    <>
      <FormRenderer fields={FIELDS} answers={answers} onChange={setAnswers} issues={issues} />
      <pre data-testid="answers">{JSON.stringify(answers)}</pre>
    </>
  );
}

const answers = () => JSON.parse(screen.getByTestId("answers").textContent || "{}");

describe("FormRenderer", () => {
  it("renders every question type with labels, help text and required markers", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "About the course" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveAccessibleDescription(
      "As it appears in the catalogue",
    );
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getByLabelText("Mode")).toBeInTheDocument();
    expect(screen.getByText("Labs")).toBeInTheDocument();
    expect(screen.getByTestId("ranked-prefs")).toBeInTheDocument();
    expect(screen.getByTestId("group-items")).toBeInTheDocument();
  });

  it("collects text, scale, choice and multi-choice answers", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Title"), "CS201");
    await user.click(screen.getByRole("radio", { name: "4" }));
    await user.selectOptions(screen.getByLabelText("Mode"), "onsite");
    await user.click(screen.getByRole("checkbox", { name: "Labs" }));
    expect(answers()).toMatchObject({ title: "CS201", score: 4, mode: "onsite", topics: ["labs"] });
  });

  it("ranks options in click order and lets them be reordered and removed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const list = screen.getByTestId("ranked-prefs");
    await user.click(within(list).getByRole("button", { name: "Rank Alpha" }));
    expect(answers().prefs).toEqual({ order: ["a"] });
    await user.click(within(list).getByRole("button", { name: "Rank Beta" }));
    expect(answers().prefs).toEqual({ order: ["a", "b"] });
    await user.click(within(list).getByRole("button", { name: "Move Beta up" }));
    expect(answers().prefs).toEqual({ order: ["b", "a"] });
    await user.click(within(list).getByRole("button", { name: "Move Beta down" }));
    expect(answers().prefs).toEqual({ order: ["a", "b"] });
    await user.click(within(list).getByRole("button", { name: "Unrank Alpha" }));
    expect(answers().prefs).toEqual({ order: ["b"] });
  });

  it("adds and removes repeating-group rows up to the maximum", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const group = screen.getByTestId("group-items");
    await user.click(within(group).getByRole("button", { name: /Add entry/ }));
    await user.type(within(group).getByLabelText("Name"), "First");
    expect(answers().items).toEqual([{ name: "First" }]);
    await user.click(within(group).getByRole("button", { name: /Add entry/ }));
    expect(within(group).getAllByLabelText("Name")).toHaveLength(2);
    // the maximum is respected
    expect(within(group).getByRole("button", { name: /Add entry/ })).toBeDisabled();
    await user.click(within(group).getByRole("button", { name: "Remove entry 1" }));
    expect(answers().items).toHaveLength(1);
  });

  it("shows a conditional question only when its condition holds", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByLabelText("Reason")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Mode"), "online");
    expect(screen.getByLabelText("Reason")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Mode"), "onsite");
    expect(screen.queryByLabelText("Reason")).not.toBeInTheDocument();
  });

  it("shows validation issues next to their question", () => {
    render(<Harness issues={{ title: ["is required"], score: ["must be at least 1"] }} />);
    const title = screen.getByTestId("question-title");
    expect(within(title).getByRole("alert")).toHaveTextContent("is required");
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
    expect(within(screen.getByTestId("question-score")).getByRole("alert")).toHaveTextContent(
      "must be at least 1",
    );
  });
});
