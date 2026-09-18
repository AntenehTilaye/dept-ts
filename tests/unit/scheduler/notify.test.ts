import { describe, expect, it } from "vitest";
import { MassSendError } from "@/platform/scheduler/notify";
import { wrapHtml } from "@/platform/scheduler/channels/html";

describe("notify helpers", () => {
  it("MassSendError carries counts", () => {
    const e = new MassSendError(250, 200);
    expect(e.message).toMatch(/250 recipients exceeds the mass-send threshold of 200/);
    expect(e.recipients).toBe(250);
  });

  it("wrapHtml escapes text, splits paragraphs, links URLs and renders the action button", () => {
    const html = wrapHtml(
      "T <x>",
      "Line one\n\nVisit https://example.org/a?b=1 now",
      "https://example.org/open",
    );
    expect(html).toContain("T &lt;x&gt;");
    expect(html).toContain('<a href="https://example.org/a?b=1"');
    expect(html.match(/<p style="margin:0 0 12px 0/g)).toHaveLength(2);
    expect(html).toContain('href="https://example.org/open"');
    expect(wrapHtml("t", "b")).not.toContain(">Open<");
  });
});
