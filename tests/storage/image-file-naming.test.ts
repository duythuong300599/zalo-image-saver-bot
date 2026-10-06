import { describe, expect, it } from "vitest";

import {
  buildImageFileName,
  resolveImageExtension,
  sanitizeMessageId,
} from "../../src/storage/image-file-naming";

describe("resolveImageExtension", () => {
  it.each([
    ["image/jpeg", "https://x/y", "jpg"],
    ["image/png; charset=x", "https://x/y", "png"],
    ["IMAGE/WEBP", "https://x/y", "webp"],
    [null, "https://x/y.png?x=1", "png"],
    [null, "https://x/y.exe", "jpg"],
    [null, "not a url", "jpg"],
  ])("contentType=%s url=%s -> %s", (contentType, url, expected) => {
    expect(resolveImageExtension(contentType, url)).toBe(expected);
  });
});

describe("sanitizeMessageId", () => {
  it("strips path traversal and slash characters", () => {
    const sanitized = sanitizeMessageId("../../etc/passwd");
    expect(sanitized).not.toContain("/");
    expect(sanitized).not.toContain("..");
  });

  it("falls back to 'unknown' for an empty messageId", () => {
    expect(sanitizeMessageId("")).toBe("unknown");
  });

  it("replaces (not collapses) each disallowed character with an underscore", () => {
    expect(sanitizeMessageId("***")).toBe("___");
  });

  it("truncates to 64 characters", () => {
    const long = "a".repeat(100);
    expect(sanitizeMessageId(long)).toHaveLength(64);
  });
});

describe("buildImageFileName", () => {
  it("builds a human-readable UTC timestamp_messageId.ext name", () => {
    // 2026-09-29T10:04:07.000Z
    const timestampMs = Date.UTC(2026, 8, 29, 10, 4, 7);
    expect(buildImageFileName(timestampMs, "abc", "jpg")).toBe("20260929-100407_abc.jpg");
  });
});
