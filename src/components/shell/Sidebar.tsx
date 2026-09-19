"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { iconFor } from "./nav-icons";

export interface NavItem {
  /** Dynamic feature routes are built at runtime, so callers cast to Route. */
  href: Route;
  label: string;
  group?: string;
  /** Icon key (see nav-icons.tsx); defaults to the last path segment. */
  icon?: string;
}

function isActive(pathname: string, href: string, isRoot: boolean): boolean {
  return isRoot ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({
  items,
  rootHref,
  collapsed,
  onNavigate,
}: {
  items: NavItem[];
  rootHref: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = new Map<string, NavItem[]>();
  for (const item of items) {
    const g = item.group ?? "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(item);
  }
  return (
    <nav aria-label="Main" className="flex flex-col gap-4 px-2 pb-4">
      {Array.from(groups.entries()).map(([group, groupItems]) => (
        <div key={group || "main"}>
          {group && !collapsed ? (
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group}
            </p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {groupItems.map((item) => {
              const Icon = iconFor(
                item.icon ??
                  (item.href === rootHref ? "overview" : (item.href.split("/").pop() ?? "")),
              );
              const active = isActive(pathname, item.href, item.href === rootHref);
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active && "bg-accent font-medium text-accent-foreground",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {collapsed ? (
                    <span className="sr-only">{item.label}</span>
                  ) : (
                    <span className="truncate">{item.label}</span>
                  )}
                </Link>
              );
              return (
                <li key={item.href}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Desktop: collapsible rail; mobile: a sheet opened from the header. */
export function Sidebar({
  rootHref,
  title,
  subtitle,
  items,
}: {
  rootHref: string;
  title: string;
  subtitle: string;
  items: NavItem[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <TooltipProvider>
      <aside
        aria-label="Sidebar"
        className={cn(
          "hidden shrink-0 flex-col border-r bg-card transition-[width] md:flex",
          collapsed ? "w-14" : "w-60",
        )}
      >
        <div
          className={cn("flex items-center gap-2 px-3 py-3", collapsed && "justify-center px-0")}
        >
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <Link href={rootHref as Route} className="text-base font-semibold tracking-tight">
                {title}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            </div>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
          </Button>
        </div>
        <NavList items={items} rootHref={rootHref} collapsed={collapsed} />
      </aside>
    </TooltipProvider>
  );
}

export function MobileNav({
  rootHref,
  title,
  subtitle,
  items,
}: {
  rootHref: string;
  title: string;
  subtitle: string;
  items: NavItem[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
          <MenuIcon />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <div className="px-4 py-3">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <NavList
          items={items}
          rootHref={rootHref}
          collapsed={false}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
