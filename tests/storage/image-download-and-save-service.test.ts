import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createImageStorage } from "../../src/storage/image-download-and-save-service";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zisb-test-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * `new Response()` never populates `.url` (that's normally set by the
 * fetch algorithm), but our code now validates it — so test doubles must
 * set it explicitly to stand in for a real fetch() response.
 */
function withUrl(response: Response, url: string): Response {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function pngResponse(
  payload = Buffer.from([1, 2, 3]),
  url = "https://cdn.example.com/a.png",
): Response {
  return withUrl(
    new Response(Buffer.concat([PNG_SIGNATURE, payload]), {
      status: 200,
      headers: { "content-type": "image/png" },
    }),
    url,
  );
}

describe("createImageStorage.downloadAndSave", () => {
  it("saves the response body under the expected file name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pngResponse(Buffer.from("hello"))));
    const now = () => Date.UTC(2026, 8, 29, 10, 4, 7);
    const storage = createImageStorage({ saveDir: tmpDir, now });

    const saved = await storage.downloadAndSave("https://cdn.example.com/a.png", "msg-1");
    const expected = Buffer.concat([PNG_SIGNATURE, Buffer.from("hello")]);

    expect(saved.fileName).toBe("20260929-100407_msg-1.png");
    expect(await fs.readFile(saved.filePath)).toEqual(expected);
    expect(saved.bytes).toBe(expected.length);
  });

  it("appends a numeric suffix on filename collision, keeping the original file intact", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(pngResponse(Buffer.from("first")))
        .mockResolvedValueOnce(pngResponse(Buffer.from("second"))),
    );
    const now = () => Date.UTC(2026, 8, 29, 10, 4, 7);
    const storage = createImageStorage({ saveDir: tmpDir, now });

    const first = await storage.downloadAndSave("https://cdn.example.com/a.png", "msg-1");
    const second = await storage.downloadAndSave("https://cdn.example.com/a.png", "msg-1");

    expect(second.fileName).toBe("20260929-100407_msg-1_1.png");
    expect(await fs.readFile(first.filePath)).toEqual(Buffer.concat([PNG_SIGNATURE, Buffer.from("first")]));
    expect(await fs.readFile(second.filePath)).toEqual(
      Buffer.concat([PNG_SIGNATURE, Buffer.from("second")]),
    );
  });

  it("retries once on 429 then succeeds, calling fetch exactly twice", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(pngResponse());
    vi.stubGlobal("fetch", fetchMock);
    const storage = createImageStorage({ saveDir: tmpDir, retrySleep: async () => {} });

    await storage.downloadAndSave("https://cdn.example.com/a.png", "msg-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on 404 without retrying and leaves no file behind", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const storage = createImageStorage({ saveDir: tmpDir });

    await expect(storage.downloadAndSave("https://cdn.example.com/a.png", "msg-1")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(tmpDir)).toHaveLength(0);
  });

  it("rejects unsupported content-type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        withUrl(
          new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
          "https://cdn.example.com/a.html",
        ),
      ),
    );
    const storage = createImageStorage({ saveDir: tmpDir });

    await expect(
      storage.downloadAndSave("https://cdn.example.com/a.html", "msg-1"),
    ).rejects.toThrow(/content-type/);
  });

  it("rejects a payload whose bytes don't match its declared image content-type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        withUrl(
          new Response("<html>not really a png</html>", {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
          "https://cdn.example.com/fake.png",
        ),
      ),
    );
    const storage = createImageStorage({ saveDir: tmpDir });

    await expect(
      storage.downloadAndSave("https://cdn.example.com/fake.png", "msg-1"),
    ).rejects.toThrow(/signature.*content-type: image\/png/is);
    expect(await fs.readdir(tmpDir)).toHaveLength(0);
  });

  it("rejects non-https URLs", async () => {
    const storage = createImageStorage({ saveDir: tmpDir });
    await expect(storage.downloadAndSave("http://cdn.example.com/a.png", "msg-1")).rejects.toThrow(
      /https/,
    );
  });

  it("rejects when the final response URL resolves to a private/loopback host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(pngResponse(Buffer.from([1, 2, 3]), "https://169.254.169.254/meta")),
    );
    const storage = createImageStorage({ saveDir: tmpDir });

    await expect(
      storage.downloadAndSave("https://cdn.example.com/a.png", "msg-1"),
    ).rejects.toThrow(/private|loopback/i);
    expect(await fs.readdir(tmpDir)).toHaveLength(0);
  });

  it("cleans up the partial file when the response stream errors mid-transfer", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.error(new Error("boom"));
      },
    });
    const response = withUrl(
      new Response(stream, { status: 200, headers: { "content-type": "image/png" } }),
      "https://cdn.example.com/a.png",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const storage = createImageStorage({ saveDir: tmpDir });

    await expect(storage.downloadAndSave("https://cdn.example.com/a.png", "msg-1")).rejects.toThrow();
    expect(await fs.readdir(tmpDir)).toHaveLength(0);
  });
});
