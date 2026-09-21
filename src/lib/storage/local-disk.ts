import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  assertKey,
  StorageObjectNotFoundError,
  type PutMeta,
  type StorageProvider,
  type StoredObject,
} from "./provider";

// Local-disk provider: objects under `root/yyyy/mm/<random>`. Writes go to a temporary
// sibling, are fsynced and renamed into place, so a crash never leaves a half object behind
// a valid key. The sha256 is computed while streaming.

export class LocalDiskStorage implements StorageProvider {
  constructor(
    readonly root: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private pathOf(key: string): string {
    assertKey(key);
    return join(this.root, ...key.split("/"));
  }

  private newKey(): string {
    const now = this.clock();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    return `${yyyy}/${mm}/${randomBytes(16).toString("hex")}`;
  }

  async put(source: Readable | Buffer, _meta: PutMeta): Promise<StoredObject> {
    const key = this.newKey();
    const target = this.pathOf(key);
    const tmp = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        sizeBytes += chunk.length;
        cb(null, chunk);
      },
    });
    const input = Buffer.isBuffer(source) ? Readable.from([source]) : source;
    try {
      await pipeline(input, counter, createWriteStream(tmp, { flags: "wx" }));
      const fh = await open(tmp, "r+");
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmp, target);
    } catch (error) {
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
    return { key, sizeBytes, checksum: hash.digest("hex") };
  }

  async get(key: string): Promise<Readable> {
    const path = this.pathOf(key);
    if (!(await this.exists(key))) throw new StorageObjectNotFoundError(key);
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await unlink(this.pathOf(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathOf(key))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}
