import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityHistory } from "@/modules/committees/components/ActivityHistory";

// A committee's history is read, not operated: what matters is that a reader can tell which
// kernel each row came from, and that an empty committee says so rather than showing nothing.

const rows = [
  {
    kind: "report" as const,
    at: "2026-02-01T08:00:00.000Z",
    label: "Report for January",
    by: "A. Chair",
    href: "/d/cs/f/committee_report/r1",
  },
  {
    kind: "transition" as const,
    at: "2026-01-10T09:00:00.000Z",
    label: "setup → active",
    detail: "Constituted by the head",
  },
  { kind: "document" as const, at: "2026-01-09T16:00:00.000Z", label: "Terms of reference" },
];

describe("ActivityHistory", () => {
  it("labels each row by the kind of thing that happened", () => {
    render(<ActivityHistory rows={rows} />);
    const list = screen.getByTestId("activity-history");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Report");
    expect(items[0]).toHaveTextContent("Report for January");
    expect(items[0]).toHaveTextContent("A. Chair");
    expect(items[1]).toHaveTextContent("Process");
    expect(items[2]).toHaveTextContent("Document");
  });

  it("links a row that leads somewhere, and leaves the rest as text", () => {
    render(<ActivityHistory rows={rows} />);
    const link = screen.getByRole("link", { name: "Report for January" });
    expect(link).toHaveAttribute("href", "/d/cs/f/committee_report/r1");
    expect(screen.queryByRole("link", { name: "Terms of reference" })).toBeNull();
  });

  it("shows the date of each row as a machine-readable time", () => {
    const { container } = render(<ActivityHistory rows={rows} />);
    const times = container.querySelectorAll("time");
    expect(times).toHaveLength(3);
    expect(times[0]).toHaveAttribute("dateTime", "2026-02-01T08:00:00.000Z");
    expect(times[0]).toHaveTextContent("2026-02-01");
  });

  it("says so when the committee has done nothing yet", () => {
    render(<ActivityHistory rows={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing has happened yet");
    expect(screen.queryByTestId("activity-history")).toBeNull();
  });
});
