import { describe, expect, it } from "vitest";
import {
  referencedNames,
  renderBody,
  TemplateError,
  validateBody,
} from "@/platform/template/mustache-safe";
import { previewWithSample, renderVariants } from "@/platform/template/service";

const declared = [
  { name: "name", required: true },
  { name: "items", required: false, type: "list" },
  { name: "url", required: false },
];

describe("mustache-safe", () => {
  it("rejects undeclared variables at save and lists referenced names through sections", () => {
    expect(
      referencedNames(
        "Hi {{name}} {{#items}}{{title}}{{/items}} {{^items}}none{{/items}} {{{url}}}",
      ).sort(),
    ).toEqual(["items", "name", "title", "url"]);
    expect(validateBody("Hi {{name}} and {{surname}}", declared)).toEqual(["surname"]);
    expect(validateBody("Hi {{name}}", declared)).toEqual([]);
    expect(validateBody("{{items.0}}", declared)).toEqual([]);
  });

  it("escapes HTML for in-app and email but not for sms/document", () => {
    const vars = { name: "<b>Ann</b>" };
    expect(renderBody("Hi {{name}}", "inApp", vars, declared)).toBe(
      "Hi &lt;b&gt;Ann&lt;&#x2F;b&gt;",
    );
    expect(renderBody("Hi {{name}}", "emailBody", vars, declared)).toContain("&lt;b&gt;");
    expect(renderBody("Hi {{name}}", "sms", vars, declared)).toBe("Hi <b>Ann</b>");
    expect(renderBody("Hi {{name}}", "document", vars, declared)).toBe("Hi <b>Ann</b>");
  });

  it("renders sections and loops; partials and lambdas are rejected or neutralised", () => {
    const out = renderBody(
      "{{#items}}- {{title}}\n{{/items}}{{^items}}none{{/items}}",
      "sms",
      { name: "x", items: [{ title: "a" }, { title: "b" }] },
      declared,
    );
    expect(out).toBe("- a\n- b\n");
    expect(() => validateBody("{{> header}}", declared)).toThrow(TemplateError);
    expect(() => renderBody("{{> header}}", "sms", { name: "x" }, declared)).toThrow(/Partials/);
    expect(
      renderBody("{{name}}", "sms", { name: () => "evil" }, [{ name: "name", required: false }]),
    ).toBe("");
    expect(() => validateBody("{{#open}}", declared)).toThrow(/syntax/i);
  });

  it("fails at render when a required variable is missing", () => {
    expect(() => renderBody("Hi {{name}}", "inApp", {}, declared)).toThrow(
      /Missing required variables: name/,
    );
    expect(() => renderBody("Hi {{name}}", "inApp", { name: "" }, declared)).toThrow(TemplateError);
  });

  it("renders variants and previews with sample values", () => {
    const variants = {
      inApp: "Hi {{name}}",
      emailSubject: "S {{name}}",
      emailBody: "{{#items}}{{name}}{{/items}}",
    };
    expect(
      renderVariants(
        { variants, declaredVariables: declared },
        { name: "Z", items: [{ name: "i1" }] },
        ["inApp", "emailSubject"],
      ),
    ).toEqual({ inApp: "Hi Z", emailSubject: "S Z" });
    const preview = previewWithSample(variants, declared);
    expect(preview.inApp).toBe("Hi {name}");
    expect(preview.emailBody).toContain("item 1");
  });
});
