import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 px-4">
      <h1 className="text-3xl font-semibold tracking-tight">DeptTS</h1>
      <p className="text-muted-foreground">
        Department Management Tool Suite. The platform kernel is being assembled phase by phase;
        sign-in and department selection arrive in the next phase.
      </p>
      <Button asChild>
        <a href="/api/health">Check API health</a>
      </Button>
    </main>
  );
}
