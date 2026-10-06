import { Transform, type TransformCallback } from "node:stream";

export class ByteLimitExceededError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Stream exceeded the ${limitBytes}-byte limit`);
    this.name = "ByteLimitExceededError";
  }
}

/**
 * Aborts the pipeline once more than `limitBytes` have passed through,
 * so a mislabeled Content-Length (or a streaming response with none)
 * can't fill the disk before we notice.
 */
export function createByteLimitTransform(limitBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      total += chunk.length;
      if (total > limitBytes) {
        callback(new ByteLimitExceededError(limitBytes));
        return;
      }
      callback(null, chunk);
    },
  });
}
