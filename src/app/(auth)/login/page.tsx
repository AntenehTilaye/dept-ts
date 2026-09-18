import { LoginForm } from "@/components/auth/LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Sign in</h2>
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </section>
  );
}
