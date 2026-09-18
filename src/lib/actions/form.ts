/**
 * FormData -> plain object for Zod. Repeated keys become arrays; empty strings become
 * undefined so optional fields validate; keys listed in `arrays` are always arrays.
 */
export function formToObject(
  formData: FormData,
  opts: { arrays?: string[] } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const arrays = new Set(opts.arrays ?? []);
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).map((v) => (typeof v === "string" ? v : v.name));
    if (arrays.has(key) || values.length > 1) {
      out[key] = values.filter((v) => v !== "");
    } else {
      const v = values[0];
      out[key] = v === "" || v === undefined ? undefined : v;
    }
  }
  return out;
}
