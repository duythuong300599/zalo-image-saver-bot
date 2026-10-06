export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injectable for tests — avoids real timers in the unit test suite. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5000;
const JITTER_RATIO = 0.2;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(maxDelayMs, exponential);
  const jitter = capped * JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * Generic retry wrapper. Zalo does not publish an official rate-limit
 * policy, so defaults here (3 attempts, 500ms base, 5s cap) are a
 * conservative guess, not a documented spec — tune via opts if needed.
 */
export async function retryWithExponentialBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt || !opts.isRetryable(error)) {
        throw error;
      }
      const delayMs = computeDelayMs(attempt, baseDelayMs, maxDelayMs);
      opts.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  // Unreachable: loop always returns or throws above.
  throw lastError;
}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

/** Retryable: HTTP 429/5xx, or a network-level fetch failure/timeout. */
export function isRetryableHttpOrNetworkError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status === 429 || error.status >= 500;
  }
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return true;
    // Node's undici throws a generic TypeError("fetch failed") for network faults.
    if (error instanceof TypeError && error.message.includes("fetch failed")) {
      return true;
    }
  }
  return false;
}

/**
 * Matched by exact `error.name`, not `instanceof`/message text. The SDK
 * sets `this.name = new.target.name` on every error subclass (see
 * zalo-bot-js/src/errors), so e.g. BadRequest (a NetworkError subclass)
 * reports name "BadRequest" — using instanceof here would wrongly treat
 * it as retryable via the NetworkError branch of the hierarchy.
 */
export function isRetryableZaloSdkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return ["RetryAfter", "NetworkError", "TimedOut"].includes(error.name);
}
