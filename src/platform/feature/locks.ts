import { createHash } from "node:crypto";
import { isGroup, isParallel, isStep, type FeatureDefinition, type StepNode } from "./schema";
import type { FieldDef } from "../forms/field-schema";

// What the code owns inside an authored definition (design part 03 §9). An administrator may
// rename a step of a system feature, add a notification or change a label; they may not re-point
// it at another adapter, drop a guard or change what backs the record, because those pointers
// name TypeScript that has to exist. The locks are therefore derived from the document itself
// (never hand-maintained), compared pointer by pointer on every save, and hashed so a re-seed can
// tell "the code changed" from "the administrator edited something".

/** RFC 6901 pointer, with `*` standing for "every index or key of this array or object". */
export type Pointer = string;

const ESCAPE = (segment: string) => segment.replace(/~/g, "~0").replace(/\//g, "~1");
const UNESCAPE = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");

export function pointer(...segments: (string | number)[]): Pointer {
  return "/" + segments.map((s) => ESCAPE(String(s))).join("/");
}

/** Resolves a pointer without wildcards; returns undefined when the path does not exist. */
export function resolvePointer(document: unknown, path: Pointer): unknown {
  if (path === "") return document;
  let current: unknown = document;
  for (const raw of path.split("/").slice(1)) {
    const segment = UNESCAPE(raw);
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else return undefined;
  }
  return current;
}

/** Expands `*` segments against a document into the concrete pointers that exist in it. */
export function expandPointer(document: unknown, path: Pointer): Pointer[] {
  if (!path.includes("*")) return [path];
  const segments = path.split("/").slice(1);
  let paths: Pointer[] = [""];
  segments.forEach((segment, depth) => {
    const next: Pointer[] = [];
    for (const prefix of paths) {
      const node = resolvePointer(document, prefix);
      if (segment !== "*") {
        next.push(`${prefix}/${segment}`);
        continue;
      }
      if (Array.isArray(node)) node.forEach((_, i) => next.push(`${prefix}/${i}`));
      else if (node && typeof node === "object")
        for (const key of Object.keys(node)) next.push(`${prefix}/${ESCAPE(key)}`);
      void depth;
    }
    paths = next;
  });
  return paths;
}

function fieldLocks(fields: FieldDef[] | undefined, base: Pointer, out: Pointer[]): void {
  (fields ?? []).forEach((field, i) => {
    const at = `${base}/${i}`;
    if (field.computedBy) out.push(`${at}/computedBy`);
    if (field.sourceBinding && field.sourceBinding !== "none") out.push(`${at}/sourceBinding`);
    if (field.locked) out.push(at);
    if (field.fields?.length) fieldLocks(field.fields, `${at}/fields`, out);
  });
}

function stepLocks(nodes: StepNode[], base: Pointer, out: Pointer[]): void {
  nodes.forEach((node, i) => {
    const at = `${base}/${i}`;
    if (isGroup(node)) {
      stepLocks(node.steps, `${at}/steps`, out);
      return;
    }
    if (isParallel(node)) {
      if (node.branches.mode === "static")
        node.branches.items.forEach((branch, b) =>
          stepLocks(branch.steps, `${at}/branches/items/${b}/steps`, out),
        );
      else stepLocks(node.branches.branch.steps, `${at}/branches/branch/steps`, out);
      return;
    }
    if (!isStep(node)) return;
    if (node.adapter) out.push(`${at}/adapter`);
    if (node.surface) out.push(`${at}/surface`);
    fieldLocks(node.form?.questions, `${at}/form/questions`, out);
    node.actions.forEach((action, a) => {
      const actionAt = `${at}/actions/${a}`;
      if (action.guards.length) out.push(`${actionAt}/guards`);
      if (action.effects.length) out.push(`${actionAt}/effects`);
      if (action.auto) out.push(`${actionAt}/auto`);
    });
  });
}

/**
 * The pointers a system definition may not move, derived from what it actually references.
 * A non-system definition has none: an administrator owns everything they authored.
 */
export function deriveImplicitLocks(def: FeatureDefinition, isSystem = true): Pointer[] {
  if (!isSystem) return [];
  const out: Pointer[] = ["/key", "/record/backing"];
  for (const [key, preset] of Object.entries(def.presets)) {
    const at = `/presets/${ESCAPE(key)}`;
    out.push(`${at}/adapters`, `${at}/fieldDefaults`);
    if (preset.permissionPrefix) out.push(`${at}/permissionPrefix`);
    if (preset.parentSubjectType) out.push(`${at}/parentSubjectType`);
  }
  fieldLocks(def.record.fields, "/record/fields", out);
  stepLocks(def.steps, "/steps", out);
  def.terminalStates.forEach((terminal, i) => {
    if (terminal.effects.length) out.push(`/terminalStates/${i}/effects`);
  });
  if (def.report && !["records", "records_with_answers"].includes(def.report.dataSource))
    out.push("/report/dataSource");
  return Array.from(new Set(out)).sort();
}

/** Explicit plus implicit locks, expanded against the document. */
export function allLocks(def: FeatureDefinition, isSystem = true): Pointer[] {
  const explicit = def.lockedPaths.flatMap((path) => expandPointer(def, path));
  return Array.from(new Set([...explicit, ...deriveImplicitLocks(def, isSystem)])).sort();
}

export interface LockDiff {
  path: Pointer;
  before: unknown;
  after: unknown;
}

/** Locked pointers whose value differs between two versions of the document. */
export function lockedPathsChanged(
  previous: unknown,
  next: unknown,
  locks: Pointer[],
): LockDiff[] {
  const diffs: LockDiff[] = [];
  for (const lock of locks) {
    for (const path of expandPointer(previous, lock)) {
      const before = resolvePointer(previous, path);
      const after = resolvePointer(next, path);
      if (!deepEqual(before, after)) diffs.push({ path, before, after });
    }
  }
  return diffs;
}

export class LockViolation extends Error {
  constructor(readonly diffs: LockDiff[]) {
    super(`locked path${diffs.length === 1 ? "" : "s"} changed: ${diffs.map((d) => d.path).join(", ")}`);
    this.name = "LockViolation";
  }
}

/** Throws when a locked pointer moved; used by every draft save and by publish. */
export function assertLockedPathsUnchanged(
  previous: unknown,
  next: unknown,
  locks: Pointer[],
): void {
  const diffs = lockedPathsChanged(previous, next, locks);
  if (diffs.length) throw new LockViolation(diffs);
}

/** Canonical JSON: object keys sorted, so a re-ordered document hashes the same. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/** sha256 over the locked subtree — the baseline a re-seed compares the code against. */
export function lockedHash(def: FeatureDefinition, isSystem = true): string {
  const locks = allLocks(def, isSystem);
  const picked = locks.map((path) => [path, resolvePointer(def, path)] as const);
  return createHash("sha256").update(canonical(Object.fromEntries(picked))).digest("hex");
}

/** sha256 over the whole canonical document. */
export function jsonHash(def: unknown): string {
  return createHash("sha256").update(canonical(def)).digest("hex");
}

function deepEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
