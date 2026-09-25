"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SearchIcon } from "lucide-react";
import { suggestAction } from "@/modules/search/actions";
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

interface Suggestion {
  subjectType: string;
  subjectId: string;
  title: string;
  url: string | null;
}

/** Ctrl/⌘ K: jump to any page, or to any record the index knows and this person may open. */
export function CommandPalette({ items, dept }: { items: NavItem[]; dept: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Suggestion[]>([]);
  const [, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // the index answers while somebody types; two characters is where a prefix starts to mean
  // something, and an empty box goes back to the pages
  const onQueryChange = (next: string) => {
    setQuery(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (next.trim().length < 2) {
      setHits([]);
      return;
    }
    timerRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await suggestAction({ dept, prefix: next });
        setHits(result.ok ? result.data : []);
      });
    }, 180);
  };
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
        <CommandInput
          placeholder="Type a page name, a person, a course…"
          value={query}
          onValueChange={onQueryChange}
        />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {hits.length ? (
            <CommandGroup heading="Records">
              {hits.map((hit) => (
                <CommandItem
                  key={`${hit.subjectType}:${hit.subjectId}`}
                  value={`record ${hit.title} ${hit.subjectType}`}
                  onSelect={() => {
                    setOpen(false);
                    if (hit.url) router.push(hit.url as Route);
                  }}
                >
                  <SearchIcon aria-hidden="true" /> {hit.title}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {hit.subjectType.replace(/_/g, " ")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {query.trim().length >= 2 ? (
            <CommandGroup heading="Search">
              <CommandItem
                value={`search everything ${query}`}
                onSelect={() => {
                  setOpen(false);
                  router.push(`/d/${dept}/search?q=${encodeURIComponent(query)}` as Route);
                }}
              >
                <SearchIcon aria-hidden="true" /> Search for “{query}”
              </CommandItem>
            </CommandGroup>
          ) : null}
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
