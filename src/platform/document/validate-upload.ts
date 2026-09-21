import { fileTypeFromBuffer } from "file-type";
import Papa from "papaparse";

// What the upload route accepts: a short allow-list, the declared type must agree with the
// bytes (magic numbers for binary types, a parse of the first kilobyte for CSV, UTF-8 for
// text), and the size cap. Names are only kept as `originalName`; keys never derive from them.

export interface UploadCandidate {
  originalName: string;
  /** Type the browser declared. */
  declaredType: string;
  bytes: Buffer;
}

export type UploadValidation =
  | { ok: true; mimeType: string; extension: string }
  | { ok: false; code: "too_large" | "unsupported" | "mismatch" | "empty"; message: string };

interface Allowed {
  mime: string;
  extensions: string[];
  /** Magic-number check (file-type) or a content check. */
  check: "magic" | "csv" | "text";
}

export const ALLOWED: Allowed[] = [
  { mime: "application/pdf", extensions: ["pdf"], check: "magic" },
  { mime: "image/png", extensions: ["png"], check: "magic" },
  { mime: "image/jpeg", extensions: ["jpg", "jpeg"], check: "magic" },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: ["xlsx"],
    check: "magic",
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
    check: "magic",
  },
  { mime: "text/csv", extensions: ["csv"], check: "csv" },
  { mime: "text/plain", extensions: ["txt"], check: "text" },
  { mime: "text/markdown", extensions: ["md"], check: "text" },
];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isUtf8Text(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

function looksLikeMarkup(bytes: Buffer): boolean {
  return /^\s*<(!doctype|html|\?xml|script)/i.test(bytes.subarray(0, 256).toString("latin1"));
}

export async function validateUpload(
  candidate: UploadCandidate,
  maxBytes: number,
): Promise<UploadValidation> {
  if (candidate.bytes.length === 0)
    return { ok: false, code: "empty", message: "The file is empty" };
  if (candidate.bytes.length > maxBytes)
    return {
      ok: false,
      code: "too_large",
      message: `The file exceeds the ${Math.round(maxBytes / 1_048_576)} MB limit`,
    };
  const ext = extensionOf(candidate.originalName);
  const allowed = ALLOWED.find((a) => a.extensions.includes(ext));
  if (!allowed)
    return {
      ok: false,
      code: "unsupported",
      message: `Unsupported file type ".${ext || "?"}"; allowed: ${ALLOWED.flatMap((a) => a.extensions).join(", ")}`,
    };
  if (allowed.check === "magic") {
    const detected = await fileTypeFromBuffer(candidate.bytes);
    if (!detected || detected.mime !== allowed.mime)
      return {
        ok: false,
        code: "mismatch",
        message: `The content does not look like a .${ext} file${detected ? ` (${detected.mime})` : ""}`,
      };
    return { ok: true, mimeType: allowed.mime, extension: ext };
  }
  if (!isUtf8Text(candidate.bytes) || looksLikeMarkup(candidate.bytes))
    return { ok: false, code: "mismatch", message: `The content is not a text .${ext} file` };
  if (allowed.check === "csv") {
    const head = candidate.bytes.subarray(0, 1024).toString("utf8");
    // a single-column file has no detectable delimiter and ragged rows are fine; broken quoting is not
    const parsed = Papa.parse<string[]>(head, { skipEmptyLines: true });
    const fatal = parsed.errors.filter((e) => e.type === "Quotes");
    if (fatal.length || parsed.data.length === 0)
      return { ok: false, code: "mismatch", message: "The content does not parse as CSV" };
  }
  return { ok: true, mimeType: allowed.mime, extension: ext };
}

/** Effective upload cap: SystemSetting upload.maxBytes over the UPLOAD_MAX_MB environment default. */
export function maxUploadBytes(settingBytes: unknown, envMb: number): number {
  if (typeof settingBytes === "number" && settingBytes > 0) return Math.floor(settingBytes);
  return Math.floor(envMb * 1_048_576);
}
