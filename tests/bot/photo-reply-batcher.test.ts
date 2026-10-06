import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildBatchReplyText,
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

describe("buildBatchReplyText", () => {
  it("returns the plain single-photo success text for exactly one success", () => {
    expect(buildBatchReplyText(1, 0)).toBe(SUCCESS_REPLY);
  });

  it("returns the plain single-photo failure text for exactly one failure", () => {
    expect(buildBatchReplyText(0, 1)).toBe(FAILURE_REPLY);
  });

  it("pluralizes an all-success batch", () => {
    expect(buildBatchReplyText(5, 0)).toBe("Đã lưu 5 ảnh thành công ✅");
  });

  it("pluralizes an all-failure batch", () => {
    expect(buildBatchReplyText(0, 3)).toBe("Lưu 3 ảnh thất bại ❌ Vui lòng gửi lại các ảnh đó.");
  });

  it("summarizes a mixed success/failure batch", () => {
    expect(buildBatchReplyText(4, 2)).toBe(
      "Đã lưu 4 ảnh thành công ✅, 2 ảnh lỗi ❌ vui lòng gửi lại ảnh lỗi.",
    );
  });
});

describe("createPhotoReplyBatcher", () => {
  it("sends one reply after a burst of successes for the same chat, counting all of them", async () => {
    const messenger = makeMessenger();
    const batcher = createPhotoReplyBatcher({ messenger, debounceMs: 2000, replyRetrySleep: async () => {} });

    batcher.recordOutcome("c1", "success");
    batcher.recordOutcome("c1", "success");
    batcher.recordOutcome("c1", "success");
    await vi.advanceTimersByTimeAsync(2000);

    expect(messenger.sendMessage).toHaveBeenCalledTimes(1);
    expect(messenger.sendMessage).toHaveBeenCalledWith("c1", "Đã lưu 3 ảnh thành công ✅");
  });

  it("resets the quiet-period timer on each new photo, so a reply only fires after the burst ends", async () => {
    const messenger = makeMessenger();
    const batcher = createPhotoReplyBatcher({ messenger, debounceMs: 2000, replyRetrySleep: async () => {} });

    batcher.recordOutcome("c1", "success");
    await vi.advanceTimersByTimeAsync(1500);
    batcher.recordOutcome("c1", "success"); // arrives before the first timer would fire
    await vi.advanceTimersByTimeAsync(1500);

    expect(messenger.sendMessage).not.toHaveBeenCalled(); // still within 2000ms of the 2nd photo

    await vi.advanceTimersByTimeAsync(500);
    expect(messenger.sendMessage).toHaveBeenCalledTimes(1);
    expect(messenger.sendMessage).toHaveBeenCalledWith("c1", "Đã lưu 2 ảnh thành công ✅");
  });

  it("keeps separate batches per chatId", async () => {
    const messenger = makeMessenger();
    const batcher = createPhotoReplyBatcher({ messenger, debounceMs: 2000, replyRetrySleep: async () => {} });

    batcher.recordOutcome("c1", "success");
    batcher.recordOutcome("c2", "success");
    batcher.recordOutcome("c2", "failure");
    await vi.advanceTimersByTimeAsync(2000);

    expect(messenger.sendMessage).toHaveBeenCalledTimes(2);
    expect(messenger.sendMessage).toHaveBeenCalledWith("c1", SUCCESS_REPLY);
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      "c2",
      "Đã lưu 1 ảnh thành công ✅, 1 ảnh lỗi ❌ vui lòng gửi lại ảnh lỗi.",
    );
  });

  it("logs instead of throwing when sendMessage keeps failing", async () => {
    const messenger: BotMessenger = { sendMessage: vi.fn().mockRejectedValue(new Error("down")) };
    const batcher = createPhotoReplyBatcher({
      messenger,
      debounceMs: 2000,
      replyRetrySleep: async () => {},
      logger: quietLogger,
    });

    batcher.recordOutcome("c1", "success");
    await vi.advanceTimersByTimeAsync(2000);
    await vi.runOnlyPendingTimersAsync(); // let the internal retry's sleep() resolve

    expect(quietLogger.error).toHaveBeenCalled();
  });
});
