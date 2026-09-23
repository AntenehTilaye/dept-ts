import Mustache from "mustache";

// Logic-less mustache with the sharp edges removed: partials and lambdas are rejected,
// undeclared variables fail at save, missing required ones at render.
//
// Every variant renders as plain text. Escaping belongs to the sink, not to the renderer: the
// in-app variant is React text and the mail body is escaped by `wrapHtml` on its way into the
// HTML part. Escaping here would escape a second time — it turned the "/" of a campaign link
// into "&#x2F;" in the text/plain part of the invitation mail.

export type Variant = "inApp" | "emailSubject" | "emailBody" | "sms" | "document";

export interface DeclaredVariable {
  name: string;
  required: boolean;
  type?: string;
}

export class TemplateError extends Error {
  constructor(
    message: string,
    public readonly code: "undeclared" | "partial" | "syntax" | "missing",
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

/** Top-level names referenced by a body (sections walk into their children). */
export function referencedNames(body: string): string[] {
  let tokens: ReturnType<typeof Mustache.parse>;
  try {
    tokens = Mustache.parse(body);
  } catch (error) {
    throw new TemplateError(
      `Template syntax error: ${error instanceof Error ? error.message : String(error)}`,
      "syntax",
    );
  }
  const names = new Set<string>();
  const walk = (list: unknown[]) => {
    for (const t of list as Array<[string, string, number, number, unknown[]?]>) {
      const [type, name] = t;
      if (type === ">")
        throw new TemplateError(`Partials are not allowed ({{> ${name}}})`, "partial");
      if (type === "name" || type === "&" || type === "{" || type === "#" || type === "^") {
        if (name !== ".") names.add(name.split(".")[0]!);
      }
      if ((type === "#" || type === "^") && Array.isArray(t[4])) walk(t[4]);
    }
  };
  walk(tokens);
  return Array.from(names);
}

/** Save-time validation: every referenced name must be declared. */
export function validateBody(body: string, declared: DeclaredVariable[]): string[] {
  const allowed = new Set(declared.map((d) => d.name));
  return referencedNames(body).filter((n) => !allowed.has(n));
}

function stripFunctions(value: unknown): unknown {
  if (typeof value === "function") return "";
  if (Array.isArray(value)) return value.map(stripFunctions);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripFunctions(v)]),
    );
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Renders a variant; required declared variables must be present (non-empty). */
export function renderBody(
  body: string,
  _variant: Variant,
  variables: Record<string, unknown>,
  declared: DeclaredVariable[] = [],
): string {
  const missing = declared
    .filter((d) => d.required)
    .filter(
      (d) =>
        variables[d.name] === undefined || variables[d.name] === null || variables[d.name] === "",
    );
  if (missing.length)
    throw new TemplateError(
      `Missing required variables: ${missing.map((m) => m.name).join(", ")}`,
      "missing",
    );
  referencedNames(body); // rejects partials
  const view = stripFunctions(variables) as Record<string, unknown>;
  return Mustache.render(body, view, undefined, { escape: (s: string) => s });
}
