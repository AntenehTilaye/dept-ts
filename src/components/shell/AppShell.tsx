import type { ReactNode } from "react";
import { Sidebar, type NavItem } from "./Sidebar";
import { Topbar } from "./Topbar";

export interface ShellProps {
  rootHref: string;
  title: string;
  subtitle: string;
  nav: NavItem[];
  userName: string;
  userEmail: string;
  isAdmin: boolean;
  departments?: Array<{ slug: string; code: string; name: string }>;
  currentSlug?: string;
  inbox?: { unread: number; pendingAck: number } | null;
  inboxHref?: string;
  topbarExtra?: ReactNode;
  children: ReactNode;
}

/** The one application shell: sidebar + header, inherited by the department and admin areas. */
export function AppShell({ children, topbarExtra, ...props }: ShellProps) {
  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <Sidebar
        rootHref={props.rootHref}
        title={props.title}
        subtitle={props.subtitle}
        items={props.nav}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar {...props}>{topbarExtra}</Topbar>
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-8">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
