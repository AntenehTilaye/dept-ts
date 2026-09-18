import { NewPasswordForm } from "@/components/auth/PasswordForm";

export const metadata = { title: "Set password" };

// New accounts receive a mail whose link lands here with ?token=... (the reset flow).
export default async function SetPasswordPage(props: PageProps<"/set-password">) {
  const { token, error } = await props.searchParams;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Welcome to DeptTS</h2>
      {typeof token === "string" && !error ? (
        <NewPasswordForm token={token} mode="set" />
      ) : (
        <p className="text-sm text-destructive">
          This link is invalid or has expired. Ask your administrator to send a new invitation, or
          use{" "}
          <a className="underline" href="/reset-password">
            reset password
          </a>
          .
        </p>
      )}
    </section>
  );
}
