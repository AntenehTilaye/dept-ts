import { Button, Text } from "@react-email/components";
import { BaseLayout } from "./BaseLayout";

export function ResetPasswordEmail({ name, url }: { name?: string | null; url: string }) {
  return (
    <BaseLayout preview="Reset your DeptTS password">
      <Text>Hello {name ?? "there"},</Text>
      <Text>We received a request to reset your password. The link is valid for 24 hours.</Text>
      <Button
        href={url}
        style={{
          backgroundColor: "#111827",
          color: "#ffffff",
          padding: "10px 16px",
          borderRadius: "6px",
        }}
      >
        Reset password
      </Button>
      <Text style={{ color: "#6b7280", fontSize: "12px" }}>
        If you did not ask for this, you can ignore this message.
      </Text>
    </BaseLayout>
  );
}
