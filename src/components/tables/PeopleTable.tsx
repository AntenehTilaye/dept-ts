"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { columnHelper, DataTable } from "@/components/patterns/DataTable";
import { UserPlusIcon } from "lucide-react";

export interface PersonRow {
  id: string;
  fullName: string;
  email: string | null;
  type: string;
  status: string;
  isStaff: boolean;
  href: string;
}

const h = columnHelper<PersonRow>();
const columns = [
  h.accessor("fullName", {
    header: "Name",
    cell: (c) => (
      <span className="flex items-center gap-2">
        <a className="font-medium underline-offset-2 hover:underline" href={c.row.original.href}>
          {c.getValue()}
        </a>
        {c.row.original.isStaff ? <Badge variant="secondary">staff</Badge> : null}
      </span>
    ),
  }),
  h.accessor("email", { header: "Email", cell: (c) => c.getValue() ?? "—" }),
  h.accessor("type", { header: "Type" }),
  h.accessor("status", {
    header: "Status",
    cell: (c) => (
      <Badge variant={c.getValue() === "active" ? "outline" : "secondary"}>{c.getValue()}</Badge>
    ),
  }),
];

export function PeopleTable({ rows, canManage }: { rows: PersonRow[]; canManage: boolean }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowTestId={(r) => `person-${r.email ?? r.id}`}
      emptyTitle="No one matches."
      emptyHint="People appear here once they are linked to this department — staff profiles, students and external contacts."
      emptyAction={
        canManage ? (
          <Button size="sm" asChild>
            <a href="#add-person">
              <UserPlusIcon /> Add the first person
            </a>
          </Button>
        ) : undefined
      }
    />
  );
}
