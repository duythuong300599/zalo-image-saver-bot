import path from "node:path";

export const FALLBACK_IMAGE_EXTENSION = "jpg";

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

const URL_EXTENSION_ALLOWLIST = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
  "bmp",
  "avif",
]);

function normalizeExtension(ext: string): string {
  return ext === "jpeg" ? "jpg" : ext;
}

/** Content-Type wins; falls back to the URL path extension, then a hardcoded default. */
export function resolveImageExtension(contentType: string | null, url: string): string {
  if (contentType) {
    const mime = contentType.split(";")[0]?.trim().toLowerCase();
    if (mime && MIME_TO_EXTENSION[mime]) {
      return MIME_TO_EXTENSION[mime];
    }
  }

  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).slice(1).toLowerCase();
    if (URL_EXTENSION_ALLOWLIST.has(ext)) {
      return normalizeExtension(ext);
    }
  } catch {
    // Invalid URL — fall through to default below.
  }

  return FALLBACK_IMAGE_EXTENSION;
}

const SANITIZE_PATTERN = /[^A-Za-z0-9_-]/g;
const MAX_MESSAGE_ID_LENGTH = 64;

/** Strips anything but [A-Za-z0-9_-] so the result can never contain `..` or `/` (path traversal guard). */
export function sanitizeMessageId(messageId: string): string {
  const sanitized = messageId.replace(SANITIZE_PATTERN, "_").slice(0, MAX_MESSAGE_ID_LENGTH);
  return sanitized.length > 0 ? sanitized : "unknown";
}

/**
 * Filename format: YYYYMMDD-HHmmss_<messageId>.<ext> (UTC) — human-readable
 * per product decision, not the epoch-ms format originally sketched in the plan.
 */
export function formatTimestampForFileName(timestampMs: number): string {
  const d = new Date(timestampMs);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

export function buildImageFileName(
  timestampMs: number,
  messageId: string,
  ext: string,
): string {
  const timestamp = formatTimestampForFileName(timestampMs);
  return `${timestamp}_${sanitizeMessageId(messageId)}.${ext}`;
}
