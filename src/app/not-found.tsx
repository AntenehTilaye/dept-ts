import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        The page you asked for does not exist or you may not view it.
      </p>
      <Link className="underline" href="/">
        Back to the start page
      </Link>
    </main>
  );
}
