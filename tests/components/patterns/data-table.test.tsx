import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { columnHelper, DataTable } from "@/components/patterns/DataTable";

interface Row {
  id: string;
  name: string;
  n: number;
}
const h = columnHelper<Row>();
const columns = [h.accessor("name", { header: "Name" }), h.accessor("n", { header: "Count" })];
const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({
  id: `r${i}`,
  name: i === 3 ? "Needle" : `Row ${i}`,
  n: 30 - i,
}));

describe("DataTable", () => {
  it("filters, sorts and pages client-side", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Filter rows"
        rowTestId={(r) => `row-${r.id}`}
      />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(26); // header + 25 per page
    expect(screen.getByText("1–25 of 30")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("26–30 of 30")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Filter rows"), "needle");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByTestId("row-r3")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Filter rows"));

    // numeric columns sort descending first (TanStack auto sort direction)
    await user.click(screen.getByRole("button", { name: /Count/ }));
    expect(within(screen.getAllByRole("row")[1]!).getByText("Row 0")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")[1]).toHaveAttribute("aria-sort", "descending");
    await user.click(screen.getByRole("button", { name: /Count/ }));
    expect(within(screen.getAllByRole("row")[1]!).getByText("Row 29")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")[1]).toHaveAttribute("aria-sort", "ascending");
  });

  it("shows the empty state, and a filter-specific one when the filter hides everything", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={rows.slice(0, 2)}
        searchPlaceholder="Filter rows"
        emptyTitle="Nothing yet"
      />,
    );
    await user.type(screen.getByLabelText("Filter rows"), "zzz");
    expect(screen.getByRole("status")).toHaveTextContent("No rows match the filter");
    const { unmount } = render(<DataTable columns={columns} data={[]} emptyTitle="Nothing yet" />);
    expect(screen.getAllByRole("status").at(-1)).toHaveTextContent("Nothing yet");
    unmount();
  });

  it("lets the user hide a column", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={rows.slice(0, 2)} searchPlaceholder="Filter" />);
    // Radix opens the menu on pointerdown (which jsdom's click does not model) or on Enter
    screen.getByRole("button", { name: "Columns" }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Count" }));
    expect(screen.queryByRole("columnheader", { name: /Count/ })).not.toBeInTheDocument();
  });
});
