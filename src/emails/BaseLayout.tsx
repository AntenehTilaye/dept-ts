import { Body, Container, Head, Html, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";

export function BaseLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: "#f6f7f9",
          fontFamily: "Helvetica, Arial, sans-serif",
          margin: 0,
        }}
      >
        <Container
          style={{
            backgroundColor: "#ffffff",
            margin: "24px auto",
            padding: "24px",
            maxWidth: "560px",
            borderRadius: "8px",
          }}
        >
          <Section>
            <Text style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 16px" }}>DeptTS</Text>
            {children}
          </Section>
          <Section
            style={{ borderTop: "1px solid #e5e7eb", marginTop: "24px", paddingTop: "12px" }}
          >
            <Text style={{ color: "#6b7280", fontSize: "12px", margin: 0 }}>
              Department Management Tool Suite
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
