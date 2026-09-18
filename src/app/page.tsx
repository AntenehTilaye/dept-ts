import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/require";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

// Public landing page: signed-in users go straight to the department picker.
export default async function HomePage() {
  const session = await getSession();
  if (session) redirect("/select-department");
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 px-4">
      <h1 className="text-3xl font-semibold tracking-tight">DeptTS</h1>
      <p className="text-muted-foreground">
        Department Management Tool Suite. Accounts are created by the faculty administrator; sign in
        with the email and password you were given.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <a href="/api/health">Check API health</a>
        </Button>
      </div>
    </main>
  );
}
