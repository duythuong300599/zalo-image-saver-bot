export interface InFlightTaskTracker {
  /** Registers a promise so `waitForIdle` can await it during shutdown. Returns the same promise. */
  track<T>(promise: Promise<T>): Promise<T>;
  /** Resolves once every currently-tracked promise has settled (success or failure). */
  waitForIdle(): Promise<void>;
}

/**
 * The webhook route responds 200 before the photo download finishes (see
 * create-express-app.ts) so Zalo doesn't time out and retry — but that
 * detaches the download from the HTTP request's lifecycle, so
 * `server.close()` alone does not wait for it. Without this tracker, a
 * SIGTERM mid-download kills the process before the catch block's file
 * cleanup runs, leaving a truncated/empty file on disk.
 */
export function createInFlightTaskTracker(): InFlightTaskTracker {
  const pending = new Set<Promise<unknown>>();

  return {
    track<T>(promise: Promise<T>): Promise<T> {
      // The caller already attaches its own .catch() to `promise` for error
      // reporting — `settled` only signals "has this finished yet?" for
      // waitForIdle(), so it's deliberately neutered with .catch(() => {})
      // to avoid creating a second, un-awaited unhandled-rejection source.
      const settled = promise.catch(() => undefined).finally(() => pending.delete(settled));
      pending.add(settled);
      return promise;
    },
    async waitForIdle(): Promise<void> {
      await Promise.allSettled(Array.from(pending));
    },
  };
}
