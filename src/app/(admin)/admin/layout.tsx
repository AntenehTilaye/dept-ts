import Link from "next/link";
import type { ReactNode } from "react";
import { adminPageContext } from "@/lib/auth/page";
import { signOutAction } from "@/app/(auth)/select-department/actions";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/departments", label: "Departments" },
  { href: "/admin/permissions", label: "Permissions" },
  { href: "/admin/settings", label: "Settings" },
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await adminPageContext();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="px-4 py-4">
          <Link href="/admin" className="text-lg font-semibold tracking-tight">
            DeptTS
          </Link>
          <p className="text-xs text-muted-foreground">Faculty administration</p>
        </div>
        <nav className="flex flex-col px-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:px-8">
          <Link href="/select-department" className="text-sm underline">
            Back to departments
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm">{ctx.user.email}</span>
            <form action={signOutAction}>
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
