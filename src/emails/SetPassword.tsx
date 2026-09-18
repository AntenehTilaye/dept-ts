import { Button, Text } from "@react-email/components";
import { BaseLayout } from "./BaseLayout";

export function SetPasswordEmail({ name, url }: { name?: string | null; url: string }) {
  return (
    <BaseLayout preview="Set your DeptTS password">
      <Text>Hello {name ?? "there"},</Text>
      <Text>An account has been created for you. Choose a password to start using DeptTS.</Text>
      <Button
        href={url}
        style={{
          backgroundColor: "#111827",
          color: "#ffffff",
          padding: "10px 16px",
          borderRadius: "6px",
        }}
      >
        Set password
      </Button>
      <Text style={{ color: "#6b7280", fontSize: "12px" }}>
        If the button does not work, open this link: {url}
      </Text>
    </BaseLayout>
  );
}
