import { expandPointer, resolvePointer, type Pointer } from "../locks";

// A system feature has two authors: the code owns the locked pointers, the administrator owns
// everything else. When a release changes the code side, the administrator's edits must survive:
// merging takes their document and writes only the locked subtree back from the code.

const UNESCAPE = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");

/** Writes `value` at an RFC 6901 pointer, creating the objects on the way. */
export function setPointer(document: unknown, path: Pointer, value: unknown): void {
  const segments = path.split("/").slice(1).map(UNESCAPE);
  let current: unknown = document;
  for (const [i, segment] of segments.entries()) {
    const last = i === segments.length - 1;
    if (current === null || typeof current !== "object") return;
    const container = current as Record<string, unknown>;
    const key = Array.isArray(container) ? Number(segment) : segment;
    if (last) {
      if (value === undefined) {
        if (Array.isArray(container)) container.splice(Number(key), 1);
        else delete container[String(key)];
      } else container[String(key)] = value;
      return;
    }
    if (container[String(key)] === undefined) {
      // only fill in a missing object when the next segment is a name, never a gap in an array
      if (!Number.isInteger(Number(segments[i + 1]))) container[String(key)] = {};
      else return;
    }
    current = container[String(key)];
  }
}

/**
 * The administrator's document with the code's locked subtree written back into it.
 * Pointers the code no longer has are removed, so a guard dropped in a release disappears.
 */
export function mergeLocked(currentJson: unknown, codeJson: unknown, locks: Pointer[]): unknown {
  const merged = structuredClone(currentJson);
  const paths = new Set<Pointer>();
  for (const lock of locks) {
    for (const path of expandPointer(codeJson, lock)) paths.add(path);
    for (const path of expandPointer(currentJson, lock)) paths.add(path);
  }
  for (const path of paths) setPointer(merged, path, resolvePointer(codeJson, path));
  return merged;
}
