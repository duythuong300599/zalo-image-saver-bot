import { pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  ByteLimitExceededError,
  createByteLimitTransform,
} from "../../src/storage/byte-limit-transform-stream";

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

describe("createByteLimitTransform", () => {
  it("passes chunks through untouched while under the limit", async () => {
    const { writable, chunks } = sink();

    await pipeline(Readable.from([Buffer.from("ab"), Buffer.from("cd")]), createByteLimitTransform(10), writable);

    expect(Buffer.concat(chunks).toString()).toBe("abcd");
  });

  it("aborts with ByteLimitExceededError once total bytes exceed the limit, without writing the overflow chunk", async () => {
    const { writable, chunks } = sink();

    await expect(
      pipeline(
        Readable.from([Buffer.from("ab"), Buffer.from("cdef")]),
        createByteLimitTransform(3),
        writable,
      ),
    ).rejects.toThrow(ByteLimitExceededError);
    // The first chunk (2 bytes, under the 3-byte cap) is forwarded; the
    // second chunk pushes the running total over the cap and is dropped.
    expect(Buffer.concat(chunks).toString()).toBe("ab");
  });
});
