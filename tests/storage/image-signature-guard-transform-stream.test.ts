import { pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  createImageSignatureGuardTransform,
  UnrecognizedImageSignatureError,
} from "../../src/storage/image-signature-guard-transform-stream";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sink(): { writable: Writable; chunks: Buffer[] } {
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk, _enc, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  return { writable, chunks };
}

async function run(chunks: Buffer[]): Promise<Buffer[]> {
  const { writable, chunks: out } = sink();
  await pipeline(Readable.from(chunks), createImageSignatureGuardTransform(), writable);
  return out;
}

describe("createImageSignatureGuardTransform", () => {
  it("passes a real PNG signature through unchanged", async () => {
    const payload = Buffer.concat([PNG_SIGNATURE, Buffer.from("rest-of-file")]);
    const out = await run([payload.subarray(0, 5), payload.subarray(5)]);
    expect(Buffer.concat(out)).toEqual(payload);
  });

  it("rejects content that never matches a known image signature", async () => {
    await expect(run([Buffer.from("<html>not an image</html>")])).rejects.toThrow(
      UnrecognizedImageSignatureError,
    );
  });

  it("includes a hex preview of the rejected bytes in the error, for diagnosing real-world rejections", async () => {
    const payload = Buffer.from("<html>not an image</html>");
    await expect(run([payload])).rejects.toThrow(
      new RegExp(payload.subarray(0, 12).toString("hex")),
    );
  });

  it("rejects a completely empty body instead of passing it through as a 0-byte file", async () => {
    // Regression test: an earlier version special-cased bufferedLength === 0
    // in flush() as "nothing to check", letting an empty response silently
    // produce a 0-byte file saved as if it had succeeded.
    await expect(run([])).rejects.toThrow(UnrecognizedImageSignatureError);
  });

  it("rejects a short payload that ends before a full signature arrives", async () => {
    await expect(run([Buffer.from([0x89, 0x50])])).rejects.toThrow(UnrecognizedImageSignatureError);
  });
});
