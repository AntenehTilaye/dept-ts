import type { Readable } from "node:stream";
import type { PutMeta, StorageProvider, StoredObject } from "./provider";

// Shape of the S3-compatible provider (MinIO, AWS) for a later deployment: same key layout,
// `@aws-sdk/client-s3` with `forcePathStyle`. Not wired; every method says so.

export interface S3Config {
  bucket: string;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
}

export class S3Storage implements StorageProvider {
  constructor(readonly config: S3Config) {}
  put(_source: Readable | Buffer, _meta: PutMeta): Promise<StoredObject> {
    return Promise.reject(new Error("S3Storage is not implemented"));
  }
  get(_key: string): Promise<Readable> {
    return Promise.reject(new Error("S3Storage is not implemented"));
  }
  delete(_key: string): Promise<void> {
    return Promise.reject(new Error("S3Storage is not implemented"));
  }
  exists(_key: string): Promise<boolean> {
    return Promise.reject(new Error("S3Storage is not implemented"));
  }
}
