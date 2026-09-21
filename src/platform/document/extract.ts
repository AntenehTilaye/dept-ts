import type { Readable } from "node:stream";

// Text extraction for search and previews. Plain text and CSV now; PDF and DOCX extraction
// arrive with the search completion phase (P27) behind the same function.

export const EXTRACT_MAX_BYTES = 512 * 1024;

export const TEXT_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
]);

export function canExtract(mimeType: string): boolean {
  return TEXT_MIME_TYPES.has(mimeType);
}

/** The first EXTRACT_MAX_BYTES of a text object as a string, or null for other types. */
export async function extractText(mimeType: string, stream: Readable): Promise<string | null> {
  if (!canExtract(mimeType)) {
    stream.destroy();
    return null;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buf);
    total += buf.length;
    if (total >= EXTRACT_MAX_BYTES) {
      stream.destroy();
      break;
    }
  }
  return Buffer.concat(chunks).subarray(0, EXTRACT_MAX_BYTES).toString("utf8");
}
