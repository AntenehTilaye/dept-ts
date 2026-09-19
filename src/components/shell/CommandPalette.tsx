"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { iconFor } from "./nav-icons";
import type { NavItem } from "./Sidebar";

/** Ctrl/⌘ K: jump to any page. Record search joins in the search phase. */
export function CommandPalette({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const groups = Array.from(new Set(items.map((i) => i.group ?? "Pages")));
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="hidden gap-2 text-muted-foreground md:inline-flex"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
      >
        <SearchIcon /> Jump to…{" "}
        <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">Ctrl K</kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <SearchIcon />
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Command palette"
        description="Jump to a page"
      >
        <CommandInput placeholder="Type a page name…" />
        <CommandList>
          <CommandEmpty>No matching page.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group} heading={group}>
              {items
                .filter((i) => (i.group ?? "Pages") === group)
                .map((i) => {
                  const Icon = iconFor(i.icon ?? (i.href.split("/").pop() || "overview"));
                  return (
                    <CommandItem
                      key={i.href}
                      value={`${group} ${i.label}`}
                      onSelect={() => {
                        setOpen(false);
                        router.push(i.href as Route);
                      }}
                    >
                      <Icon aria-hidden="true" /> {i.label}
                    </CommandItem>
                  );
                })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
