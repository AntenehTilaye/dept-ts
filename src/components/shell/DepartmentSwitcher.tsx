"use client";

import { useTransition } from "react";
import { ChevronsUpDownIcon } from "lucide-react";
import { selectDepartmentAction } from "@/app/(auth)/select-department/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Switching departments goes through the server action so the session records the choice. */
export function DepartmentSwitcher({
  current,
  departments,
}: {
  current: string;
  departments: Array<{ slug: string; code: string; name: string }>;
}) {
  const [pending, start] = useTransition();
  const active = departments.find((d) => d.slug === current);
  if (departments.length <= 1) {
    return (
      <span className="truncate text-sm font-medium">
        {active ? `${active.name} (${active.code})` : ""}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-64 gap-2"
          aria-label="Switch department"
          disabled={pending}
        >
          <span className="truncate">
            {active ? `${active.name} (${active.code})` : "Department"}
          </span>
          <ChevronsUpDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Departments</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {departments.map((d) => (
          <DropdownMenuItem
            key={d.slug}
            onSelect={() =>
              start(async () => {
                const fd = new FormData();
                fd.set("slug", d.slug);
                await selectDepartmentAction(fd);
              })
            }
          >
            <span className="truncate">{d.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{d.code}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
