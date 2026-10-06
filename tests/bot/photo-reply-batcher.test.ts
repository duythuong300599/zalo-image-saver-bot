import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCombinedFailureText,
  buildSuccessSummaryText,
  createPhotoReplyBatcher,
  FAILURE_REPLY,
  SUCCESS_REPLY,
  type BotMessenger,
} from "../../src/bot/photo-reply-batcher";

const quietLogger = { error: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeMessenger(): BotMessenger & { sendMessage: ReturnType<typeof vi.fn> } {
  return { sendMessage: vi.fn().mockResolvedValue(undefined) };
}

describe("buildSuccessSummaryText", () => {
  it("returns the plain single-photo text for exactly one success", () => {
    expect(buildSuccessSummaryText(1)).toBe(SUCCESS_REPLY);
  });

  it("pluralizes for more than one success", () => {
    expect(buildSuccessSummaryText(5)).toBe("Đã lưu 5 ảnh thành công ✅");
  });
});

describe("buildCombinedFailureText", () => {
  it("returns the plain single-photo text for exactly one failure", () => {
    expect(buildCombinedFailureText(1)).toBe(FAILURE_REPLY);
  });

  it("pluralizes for more than one failure", () => {
    expect(buildCombinedFailureText(3)).toBe("Lưu 3 ảnh thất bại ❌ Vui lòng gửi lại các ảnh đó.");
  });
});

describe("createPhotoReplyBatcher", () => {
  it("sends one reply after a burst of successes for the same chat, counting all of them", async () => {
    const messenger = makeMessenger();
    const batcher = createPhotoReplyBatcher({ messenger, debounceMs: 2000, replyRetrySleep: async () => {} });

    batcher.recordSuccess("c1");
    batcher.recordSuccess("c1");
    batcher.recordSuccess("c1");
    await vi.advanceTimersByTimeAsync(2000);

    expect(messenger.sendMessage).toHaveBeenCalledTimes(1);
    expect(messenger.sendMessage).toHaveBeenCalledWith("c1", "Đã lưu 3 ảnh thành công ✅", undefined);
  });

  it("resets the quiet-period timer on each new photo, so a reply only fires after the burst ends", async () => {
    const messenger = makeMessenger();
    const batcher = createPhotoReplyBatcher({ messenger, debounceMs: 2000, replyRetrySleep: async () => {} });

    batcher.recordSuccess("c1");
    await vi.advanceTimersByTimeAsync(1500);
    batcher.recordSuccess("c1"); // arrives before the first timer would fire
    await vi.advanceTimersByTimeAsync(1500);

    expect(messenger.sendMessage).not.toHaveBeenCalled(); // still within 2000ms of the 2nd photo

    await vi.advanceTimersByTimeAsync(500);
    expect(messenger.sendMessage).toHaveBeenCalledTimes(1);
    expect(messenger.sendMessage).toHaveBeenCalledWith("c1", "Đã lưu 2 ảnh thành công ✅", undefined);
  });

  it("keeps separate batches per chatId", async () => {
    const messenger = makeMessenger();
    const batcher = createPhotoReplyBatcher({ messenger, debounceMs: 2000, replyRetrySleep: async () => {} });

    batcher.recordSuccess("c1");
    batcher.recordSuccess("c2");
    batcher.recordSuccess("c2");
    await vi.advanceTimersByTimeAsync(2000);

    expect(messenger.sendMessage).toHaveBeenCalledTimes(2);
    expect(messenger.sendMessage).toHaveBeenCalledWith("c1", SUCCESS_REPLY, undefined);
    expect(messenger.sendMessage).toHaveBeenCalledWith("c2", "Đã lưu 2 ảnh thành công ✅", undefined);
  });

  it("reply-quotes each failed photo individually (up to the cap) so the user can tell which one failed", async () => {
    const messenger = makeMessenger();
    const batcher = createPhotoReplyBatcher({ messenger, debounceMs: 2000, replyRetrySleep: async () => {} });

    batcher.recordFailure("c1", "m1");
    batcher.recordFailure("c1", "m2");
    await vi.advanceTimersByTimeAsync(2000);

    expect(messenger.sendMessage).toHaveBeenCalledTimes(2);
    expect(messenger.sendMessage).toHaveBeenCalledWith("c1", FAILURE_REPLY, { reply_to_message_id: "m1" });
    expect(messenger.sendMessage).toHaveBeenCalledWith("c1", FAILURE_REPLY, { reply_to_message_id: "m2" });
  });

  it("falls back to one combined failure message when failures exceed the individual-reply cap", async () => {
    const messenger = makeMessenger();
    const batcher = createPhotoReplyBatcher({ messenger, debounceMs: 2000, replyRetrySleep: async () => {} });

    for (let i = 0; i < 6; i += 1) batcher.recordFailure("c1", `m${i}`);
    await vi.advanceTimersByTimeAsync(2000);

    expect(messenger.sendMessage).toHaveBeenCalledTimes(1);
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      "c1",
      "Lưu 6 ảnh thất bại ❌ Vui lòng gửi lại các ảnh đó.",
      undefined,
    );
  });

  it("sends the success summary before the individual failure replies", async () => {
    const messenger = makeMessenger();
    const batcher = createPhotoReplyBatcher({ messenger, debounceMs: 2000, replyRetrySleep: async () => {} });

    batcher.recordSuccess("c1");
    batcher.recordFailure("c1", "m1");
    await vi.advanceTimersByTimeAsync(2000);

    expect(messenger.sendMessage).toHaveBeenCalledTimes(2);
    expect(messenger.sendMessage.mock.calls[0]).toEqual(["c1", SUCCESS_REPLY, undefined]);
    expect(messenger.sendMessage.mock.calls[1]).toEqual([
      "c1",
      FAILURE_REPLY,
      { reply_to_message_id: "m1" },
    ]);
  });

  it("keeps the batch open past the debounce window while a straggler photo is still in flight", async () => {
    const messenger = makeMessenger();
    const batcher = createPhotoReplyBatcher({ messenger, debounceMs: 2000, replyRetrySleep: async () => {} });

    // 2 photos start together; only the first resolves quickly.
    batcher.recordStart("c1");
    batcher.recordStart("c1");
    batcher.recordSuccess("c1");
    await vi.advanceTimersByTimeAsync(2000);

    // Debounce window elapsed, but photo #2 never resolved — must not flush
    // (and must not undercount) yet.
    expect(messenger.sendMessage).not.toHaveBeenCalled();

    batcher.recordSuccess("c1"); // the straggler finally resolves
    await vi.advanceTimersByTimeAsync(2000);

    expect(messenger.sendMessage).toHaveBeenCalledTimes(1);
    expect(messenger.sendMessage).toHaveBeenCalledWith("c1", "Đã lưu 2 ảnh thành công ✅", undefined);
  });

  it("logs instead of throwing when sendMessage keeps failing", async () => {
    const messenger: BotMessenger = { sendMessage: vi.fn().mockRejectedValue(new Error("down")) };
    const batcher = createPhotoReplyBatcher({
      messenger,
      debounceMs: 2000,
      replyRetrySleep: async () => {},
      logger: quietLogger,
    });

    batcher.recordSuccess("c1");
    await vi.advanceTimersByTimeAsync(2000);
    await vi.runOnlyPendingTimersAsync(); // let the internal retry's sleep() resolve

    expect(quietLogger.error).toHaveBeenCalled();
  });
});
