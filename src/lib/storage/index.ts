import { env } from "../env";
import { globalSingleton } from "../singleton";
import { LocalDiskStorage } from "./local-disk";
import type { StorageProvider } from "./provider";

export * from "./provider";
export { LocalDiskStorage } from "./local-disk";

const holder = globalSingleton("storage-provider", () => ({
  current: null as StorageProvider | null,
}));

/** The process-wide provider (local disk under UPLOAD_DIR unless a test swapped it). */
export function storage(): StorageProvider {
  holder.current ??= new LocalDiskStorage(env().UPLOAD_DIR);
  return holder.current;
}

/** Test seam. */
export function setStorage(provider: StorageProvider | null): void {
  holder.current = provider;
}
