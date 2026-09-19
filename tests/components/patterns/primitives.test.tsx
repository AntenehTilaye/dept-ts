import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Field, SelectField } from "@/components/forms/Field";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SegmentedLinks } from "@/components/patterns/SegmentedLinks";
import { StatCard } from "@/components/patterns/StatCard";

describe("pattern primitives", () => {
  it("EmptyState is a status region with title, hint and action", () => {
    render(<EmptyState title="Nothing yet" hint="Add one" action={<button>Add</button>} />);
    const s = screen.getByRole("status");
    expect(s).toHaveTextContent("Nothing yet");
    expect(s).toHaveTextContent("Add one");
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("Field links label, hint and input; the required marker stays out of the label text", () => {
    render(
      <form>
        <Field name="code" label="Code" required hint="Unique" />
        <Field name="code" label="Code" />
        <SelectField name="kind" label="Kind" hint="Pick one" emptyLabel="(none)">
          <option value="a">A</option>
        </SelectField>
      </form>,
    );
    const inputs = screen.getAllByLabelText("Code");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.id).not.toBe(inputs[1]!.id);
    expect(inputs[0]).toBeRequired();
    expect(inputs[0]).toHaveAccessibleDescription("Unique");
    expect(screen.getByLabelText("Kind")).toHaveAccessibleDescription("Pick one");
    expect(screen.getAllByText("Code")[0]).toHaveTextContent(/^Code$/);
  });

  it("PageHeader renders breadcrumbs with the last crumb as the current page", () => {
    render(
      <PageHeader
        title="Offering"
        description="Desc"
        crumbs={[{ label: "Offerings", href: "/o" }, { label: "CS101" }]}
        actions={<button>Act</button>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Offering" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Offerings" })).toHaveAttribute("href", "/o");
    expect(screen.getByText("CS101")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Act" })).toBeInTheDocument();
  });

  it("SegmentedLinks marks the active option and shows counts", () => {
    render(
      <SegmentedLinks
        label="Filter"
        items={[
          { label: "All", href: "/a", active: true },
          { label: "Unread", href: "/u", active: false, count: 3 },
        ]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
    const unread = screen.getByRole("link", { name: /Unread/ });
    expect(unread).not.toHaveAttribute("aria-current");
    expect(unread).toHaveTextContent("3");
  });

  it("StatCard becomes a link when given an href", () => {
    render(<StatCard label="Users" value={7} hint="active" href="/admin/users" tone="warning" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/admin/users");
    expect(link).toHaveTextContent("Users");
    expect(link).toHaveTextContent("7");
  });
});
