import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HttpStatusError,
  isRetryableHttpOrNetworkError,
  retryWithExponentialBackoff,
} from "../../src/utils/retry-with-exponential-backoff";

const noopSleep = async (): Promise<void> => {};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("retryWithExponentialBackoff", () => {
  it("resolves on the first attempt without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithExponentialBackoff(fn, {
      isRetryable: () => true,
      sleep: noopSleep,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries retryable failures then succeeds, calling fn exactly maxAttempts-bound times", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail-1"))
      .mockRejectedValueOnce(new Error("fail-2"))
      .mockResolvedValue("ok");

    const result = await retryWithExponentialBackoff(fn, {
      maxAttempts: 3,
      isRetryable: () => true,
      sleep: noopSleep,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws immediately on a non-retryable error without retrying", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fatal"));
    await expect(
      retryWithExponentialBackoff(fn, { isRetryable: () => false, sleep: noopSleep }),
    ).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws the last error once attempts are exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still-failing"));
    await expect(
      retryWithExponentialBackoff(fn, { maxAttempts: 2, isRetryable: () => true, sleep: noopSleep }),
    ).rejects.toThrow("still-failing");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("increases delay across retries and never exceeds maxDelayMs", async () => {
    const delays: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockRejectedValueOnce(new Error("3"))
      .mockResolvedValue("ok");

    await retryWithExponentialBackoff(fn, {
      maxAttempts: 4,
      baseDelayMs: 100,
      maxDelayMs: 300,
      isRetryable: () => true,
      sleep: noopSleep,
      onRetry: (_err, _attempt, delayMs) => delays.push(delayMs),
    });

    expect(delays).toHaveLength(3);
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(300 * 1.2);
    }
    // Roughly increasing (allow jitter overlap between consecutive steps).
    expect(delays[2]).toBeGreaterThan(delays[0] * 0.5);
  });
});

describe("isRetryableHttpOrNetworkError", () => {
  it("treats 202, 429, and 5xx as retryable", () => {
    expect(isRetryableHttpOrNetworkError(new HttpStatusError(202, "photo not ready"))).toBe(true);
    expect(isRetryableHttpOrNetworkError(new HttpStatusError(429, "rate limited"))).toBe(true);
    expect(isRetryableHttpOrNetworkError(new HttpStatusError(503, "unavailable"))).toBe(true);
  });

  it("treats 403 and 404 as non-retryable", () => {
    expect(isRetryableHttpOrNetworkError(new HttpStatusError(403, "forbidden"))).toBe(false);
    expect(isRetryableHttpOrNetworkError(new HttpStatusError(404, "not found"))).toBe(false);
  });

  it("treats fetch network failures as retryable", () => {
    expect(isRetryableHttpOrNetworkError(new TypeError("fetch failed"))).toBe(true);
  });
});
