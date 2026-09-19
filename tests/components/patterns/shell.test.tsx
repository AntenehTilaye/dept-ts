import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Route } from "next";
import { Sidebar } from "@/components/shell/Sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/d/cs/people/42" }));

const items = [
  { href: "/d/cs" as Route, label: "Overview" },
  { href: "/d/cs/inbox" as Route, label: "Inbox", group: "Me" },
  { href: "/d/cs/people" as Route, label: "People", group: "Registry" },
];

describe("Sidebar", () => {
  it("groups items, marks the current section and collapses to icons with accessible names", async () => {
    const user = userEvent.setup();
    render(<Sidebar rootHref="/d/cs" title="CS" subtitle="Computer Science" items={items} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toHaveTextContent("Registry");
    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("link", { name: "People" })).toBeInTheDocument();
    expect(nav).not.toHaveTextContent("Registry");
  });
});
