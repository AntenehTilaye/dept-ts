import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">DeptTS</h1>
        <p className="text-sm text-muted-foreground">Department Management Tool Suite</p>
      </div>
      {children}
    </main>
  );
}
