import fs from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import {
  HttpStatusError,
  isRetryableHttpOrNetworkError,
  retryWithExponentialBackoff,
} from "../utils/retry-with-exponential-backoff";
import { createByteLimitTransform } from "./byte-limit-transform-stream";
import { buildImageFileName, resolveImageExtension } from "./image-file-naming";
import {
  createImageSignatureGuardTransform,
  UnrecognizedImageSignatureError,
} from "./image-signature-guard-transform-stream";

export interface SavedImage {
  filePath: string;
  fileName: string;
  bytes: number;
}

export interface ImageStorage {
  downloadAndSave(photoUrl: string, messageId: string): Promise<SavedImage>;
}

export interface ImageStorageOptions {
  saveDir: string;
  now?: () => number;
  fetchTimeoutMs?: number;
  /** Injectable retry delay fn — lets tests skip real waits between retry attempts. */
  retrySleep?: (ms: number) => Promise<void>;
}

/**
 * 10MB cap — Zalo does not publish an official max photo size. This is a
 * conservative estimate borrowed from the community `zalobot-sdk` project's
 * default as the closest available reference point, not an official Zalo spec.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const MAX_FILENAME_COLLISION_ATTEMPTS = 5;

// Matches literal loopback/private/link-local hostnames. Only guards the
// redirect target's hostname string — it does not resolve DNS, so it is
// defense-in-depth against a redirect pointing straight at an internal
// literal, not a full SSRF/DNS-rebinding protection.
const PRIVATE_OR_LOOPBACK_HOSTNAME = /^(localhost|127\.|0\.0\.0\.0|::1$|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i;

function assertPublicHttpsUrl(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new Error(`Refusing non-https URL: ${url.protocol}`);
  }
  if (PRIVATE_OR_LOOPBACK_HOSTNAME.test(url.hostname)) {
    throw new Error(`Refusing private/loopback host: ${url.hostname}`);
  }
}

function assertAcceptableContentType(contentType: string | null): void {
  if (!contentType) return;
  const mime = contentType.split(";")[0]?.trim().toLowerCase();
  if (mime && !mime.startsWith("image/") && mime !== "application/octet-stream") {
    throw new Error(`Unsupported content-type: ${contentType}`);
  }
}

function assertWithinSizeLimit(contentLength: string | null): void {
  if (!contentLength) return;
  const bytes = Number(contentLength);
  if (Number.isFinite(bytes) && bytes > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds ${MAX_IMAGE_BYTES}-byte limit (Content-Length: ${bytes})`);
  }
}

/**
 * Opens the target path exclusively (flag "wx"); on EEXIST, tries `_1`..`_N`
 * suffixes. Uses `fsPromises.open` (not `fs.createWriteStream` directly)
 * because createWriteStream's EEXIST surfaces asynchronously via an 'error'
 * event, not a thrown exception — fsPromises.open lets us await/catch it.
 */
async function openExclusiveWithSuffix(
  saveDir: string,
  fileName: string,
): Promise<{ filePath: string; stream: fs.WriteStream }> {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);

  for (let attempt = 0; attempt <= MAX_FILENAME_COLLISION_ATTEMPTS; attempt += 1) {
    const candidateName = attempt === 0 ? fileName : `${base}_${attempt}${ext}`;
    const candidatePath = path.join(saveDir, candidateName);
    // Defense in depth: sanitizeMessageId already blocks traversal chars,
    // this assertion catches any future regression before it touches disk.
    if (!candidatePath.startsWith(saveDir + path.sep)) {
      throw new Error("Resolved file path escapes SAVE_DIR");
    }
    try {
      const handle = await open(candidatePath, "wx");
      return { filePath: candidatePath, stream: handle.createWriteStream() };
    } catch (error) {
      const isExist =
        error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST";
      if (!isExist || attempt === MAX_FILENAME_COLLISION_ATTEMPTS) throw error;
    }
  }
  throw new Error("Unreachable: exhausted filename collision attempts");
}

export function createImageStorage(opts: ImageStorageOptions): ImageStorage {
  const {
    saveDir,
    now = () => Date.now(),
    fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    retrySleep,
  } = opts;

  return {
    async downloadAndSave(photoUrl: string, messageId: string): Promise<SavedImage> {
      assertPublicHttpsUrl(photoUrl);

      const response = await retryWithExponentialBackoff(
        async () => {
          const res = await fetch(photoUrl, {
            signal: AbortSignal.timeout(fetchTimeoutMs),
          });
          // Zalo's CDN returns 202 (empty body) when a photo hasn't finished
          // processing yet — observed reliably when several photos are sent
          // in one burst and the webhook fires before the CDN catches up.
          // 202 is in the 2xx "ok" range, so without this check it would
          // sail past the !res.ok guard and only fail later, confusingly,
          // at the signature check with an empty body.
          if (res.status === 202) {
            throw new HttpStatusError(202, "Photo not ready yet on Zalo's CDN (202 Accepted)");
          }
          if (!res.ok) {
            throw new HttpStatusError(res.status, `Download failed with status ${res.status}`);
          }
          return res;
        },
        {
          isRetryable: isRetryableHttpOrNetworkError,
          sleep: retrySleep,
          // Larger bursts (e.g. ~20 photos sent at once) mean more photos
          // still mid-processing on Zalo's CDN (202) at fetch time, and it
          // takes longer for the CDN to work through the whole batch — the
          // generic 3-attempt/~2s default isn't enough headroom here, so
          // this call gets its own longer budget (~7.5s across 5 attempts).
          maxAttempts: 5,
        },
      );
      // fetch() follows redirects by default; re-validate the *final*
      // response.url so a redirect can't hand us a private/loopback target.
      assertPublicHttpsUrl(response.url);

      const contentType = response.headers.get("content-type");
      assertAcceptableContentType(contentType);
      assertWithinSizeLimit(response.headers.get("content-length"));

      await mkdir(saveDir, { recursive: true });

      const ext = resolveImageExtension(contentType, photoUrl);
      const fileName = buildImageFileName(now(), messageId, ext);
      const { filePath, stream: writeStream } = await openExclusiveWithSuffix(saveDir, fileName);

      if (!response.body) {
        writeStream.destroy();
        await rm(filePath, { force: true });
        throw new Error("Response body is empty");
      }

      try {
        await pipeline(
          Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream),
          createByteLimitTransform(MAX_IMAGE_BYTES),
          createImageSignatureGuardTransform(),
          writeStream,
        );
      } catch (error) {
        await rm(filePath, { force: true });
        if (error instanceof UnrecognizedImageSignatureError) {
          // Diagnostic-only: pairs the rejected bytes' hex preview (already
          // in error.message) with the response's declared content-type and
          // length, so a real rejection can be told apart from a format gap
          // without needing to reproduce it blind next time.
          throw new Error(
            `${error.message} (http-status: ${response.status}, content-type: ${
              contentType ?? "none"
            }, content-length: ${response.headers.get("content-length") ?? "none"})`,
            { cause: error },
          );
        }
        throw error;
      }

      const { size: bytes } = await fs.promises.stat(filePath);
      return { filePath, fileName: path.basename(filePath), bytes };
    },
  };
}
