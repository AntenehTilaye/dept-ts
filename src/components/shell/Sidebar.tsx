import type { Route } from "next";
import Link from "next/link";

export interface NavItem {
  /** Dynamic feature routes are built at runtime, so callers cast to Route. */
  href: Route;
  label: string;
  group?: string;
}

export function Sidebar({
  deptSlug,
  departmentName,
  items,
}: {
  deptSlug: string;
  departmentName: string;
  items: NavItem[];
}) {
  const groups = new Map<string, NavItem[]>();
  for (const item of items) {
    const g = item.group ?? "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(item);
  }
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex" aria-label="Sidebar">
      <div className="px-4 py-4">
        <Link href={`/d/${deptSlug}`} className="text-lg font-semibold tracking-tight">
          DeptTS
        </Link>
        <p className="truncate text-xs text-muted-foreground">{departmentName}</p>
      </div>
      <nav className="flex flex-col gap-4 px-2 pb-4">
        {Array.from(groups.entries()).map(([group, groupItems]) => (
          <div key={group || "main"}>
            {group ? (
              <p className="px-2 pb-1 text-xs font-medium uppercase text-muted-foreground">
                {group}
              </p>
            ) : null}
            <ul className="flex flex-col">
              {groupItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
