import { Transform, type TransformCallback } from "node:stream";

export class UnrecognizedImageSignatureError extends Error {
  constructor(readonly headerHex: string) {
    super(`Downloaded content does not match a known image file signature (first bytes: ${headerHex})`);
    this.name = "UnrecognizedImageSignatureError";
  }
}

const HEADER_PEEK_BYTES = 12;

/** Magic-byte signatures for the image formats Zalo photos arrive as. */
function matchesKnownImageSignature(header: Buffer): boolean {
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return true; // JPEG
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return true; // PNG
  const ascii6 = header.subarray(0, 6).toString("ascii");
  if (ascii6 === "GIF87a" || ascii6 === "GIF89a") return true; // GIF
  if (
    header.subarray(0, 4).toString("ascii") === "RIFF" &&
    header.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return true; // WEBP
  return false;
}

/**
 * A server-declared `Content-Type: image/*` header is attacker-controlled —
 * it proves nothing about the actual bytes. This inspects the real leading
 * bytes of the stream so a webhook payload can't smuggle arbitrary content
 * (HTML, scripts, other binaries) onto disk under an image extension.
 */
export function createImageSignatureGuardTransform(): Transform {
  let buffered: Buffer[] = [];
  let bufferedLength = 0;
  let checked = false;

  function checkAndFlush(callback: TransformCallback): void {
    const header = Buffer.concat(buffered, bufferedLength);
    checked = true;
    if (!matchesKnownImageSignature(header)) {
      callback(new UnrecognizedImageSignatureError(header.toString("hex")));
      return;
    }
    buffered = [];
    callback(null, header);
  }

  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      if (checked) {
        callback(null, chunk);
        return;
      }
      buffered.push(chunk);
      bufferedLength += chunk.length;
      if (bufferedLength >= HEADER_PEEK_BYTES) {
        checkAndFlush(callback);
        return;
      }
      callback();
    },
    flush(callback: TransformCallback) {
      if (checked) {
        callback();
        return;
      }
      // Also covers a fully empty body (bufferedLength === 0): an empty
      // header never matches a real image signature, so it correctly
      // fails here instead of silently producing a 0-byte "saved" file.
      checkAndFlush(callback);
    },
  });
}
