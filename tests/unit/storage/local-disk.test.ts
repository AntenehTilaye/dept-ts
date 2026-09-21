import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDiskStorage } from "@/lib/storage/local-disk";
import { KEY_PATTERN, StorageKeyError, StorageObjectNotFoundError } from "@/lib/storage/provider";

let root: string;
let store: LocalDiskStorage;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "deptts-store-"));
  store = new LocalDiskStorage(root, () => new Date("2026-09-21T10:00:00Z"));
});
afterAll(() => rm(root, { recursive: true, force: true }));

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

describe("LocalDiskStorage", () => {
  it("stores under yyyy/mm/<random> with the sha256 and size of the bytes", async () => {
    const bytes = Buffer.from("hello, department\n".repeat(1000));
    const stored = await store.put(bytes, { mimeType: "text/plain" });
    expect(stored.key).toMatch(KEY_PATTERN);
    expect(stored.key.startsWith("2026/09/")).toBe(true);
    expect(stored.sizeBytes).toBe(bytes.length);
    expect(stored.checksum).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(await store.exists(stored.key)).toBe(true);
    expect(await readAll(await store.get(stored.key))).toEqual(bytes);
    expect(await readdir(join(root, "2026", "09"))).toContain(stored.key.split("/")[2]);
  });

  it("streams a source and never leaves a partial file behind", async () => {
    const stored = await store.put(Readable.from([Buffer.from("a"), Buffer.from("bc")]), {
      mimeType: "text/plain",
    });
    expect(stored.sizeBytes).toBe(3);
    const failing = new Readable({
      read() {
        this.destroy(new Error("boom"));
      },
    });
    await expect(store.put(failing, { mimeType: "text/plain" })).rejects.toThrow("boom");
    expect((await readdir(join(root, "2026", "09"))).some((f) => f.endsWith(".part"))).toBe(false);
  });

  it("keys never come from input and hostile keys are refused", async () => {
    await expect(store.get("../../etc/passwd")).rejects.toBeInstanceOf(StorageKeyError);
    await expect(store.exists("2026/09/..")).rejects.toBeInstanceOf(StorageKeyError);
    await expect(store.get(`2026/09/${"0".repeat(32)}`)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it("delete removes the object and is idempotent", async () => {
    const stored = await store.put(Buffer.from("x"), { mimeType: "text/plain" });
    await store.delete(stored.key);
    expect(await store.exists(stored.key)).toBe(false);
    await expect(store.delete(stored.key)).resolves.toBeUndefined();
  });
});
