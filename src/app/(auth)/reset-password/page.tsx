import { NewPasswordForm, RequestResetForm } from "@/components/auth/PasswordForm";

export const metadata = { title: "Reset password" };

// better-auth redirects the mail link to /reset-password?token=... after verifying it.
export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const { token, error } = await props.searchParams;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Reset your password</h2>
      {error ? (
        <p className="text-sm text-destructive">
          The reset link is invalid or has expired. Request a new one below.
        </p>
      ) : null}
      {typeof token === "string" && !error ? (
        <NewPasswordForm token={token} mode="reset" />
      ) : (
        <RequestResetForm />
      )}
    </section>
  );
}
