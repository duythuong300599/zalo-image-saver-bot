import { describe, expect, it } from "vitest";

import { createInFlightTaskTracker } from "../../src/http/in-flight-task-tracker";

describe("createInFlightTaskTracker", () => {
  it("resolves waitForIdle immediately when nothing is tracked", async () => {
    const tracker = createInFlightTaskTracker();
    await expect(tracker.waitForIdle()).resolves.toBeUndefined();
  });

  it("waits for a tracked promise to settle before resolving waitForIdle", async () => {
    const tracker = createInFlightTaskTracker();
    let resolveTask!: () => void;
    const task = new Promise<void>((resolve) => (resolveTask = resolve));
    tracker.track(task);

    let idleResolved = false;
    const idle = tracker.waitForIdle().then(() => {
      idleResolved = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(idleResolved).toBe(false);

    resolveTask();
    await idle;
    expect(idleResolved).toBe(true);
  });

  it("waits for a tracked promise even if it rejects", async () => {
    const tracker = createInFlightTaskTracker();
    const task = Promise.reject(new Error("boom"));
    tracker.track(task).catch(() => {}); // avoid an unhandled rejection in the test itself

    await expect(tracker.waitForIdle()).resolves.toBeUndefined();
  });

  it("returns the original promise unchanged from track()", async () => {
    const tracker = createInFlightTaskTracker();
    const task = Promise.resolve(42);
    await expect(tracker.track(task)).resolves.toBe(42);
  });
});
