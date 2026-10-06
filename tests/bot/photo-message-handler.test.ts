import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { createPhotoMessageHandler, type PhotoMessageLike } from "../../src/bot/photo-message-handler";
import type { PhotoReplyBatcher } from "../../src/bot/photo-reply-batcher";
import type { ImageStorage } from "../../src/storage/image-download-and-save-service";

function makeMessage(overrides: Partial<PhotoMessageLike> = {}): PhotoMessageLike {
  return { messageId: "m1", chat: { id: "c1" }, photoUrl: "https://x/y.jpg", ...overrides };
}

function makeReplyBatcher(): PhotoReplyBatcher & {
  recordOutcome: Mock<PhotoReplyBatcher["recordOutcome"]>;
} {
  return { recordOutcome: vi.fn() };
}

const quietLogger = { info: vi.fn(), error: vi.fn() };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPhotoMessageHandler", () => {
  it("records a success outcome after a successful download", async () => {
    const replyBatcher = makeReplyBatcher();
    const storage: ImageStorage = {
      downloadAndSave: vi.fn().mockResolvedValue({ filePath: "/x", fileName: "x.jpg", bytes: 1 }),
    };
    const handler = createPhotoMessageHandler({ replyBatcher, storage, logger: quietLogger });

    await handler(makeMessage());

    expect(replyBatcher.recordOutcome).toHaveBeenCalledWith("c1", "success");
  });

  it("records a failure outcome and logs when storage throws", async () => {
    const replyBatcher = makeReplyBatcher();
    const storage: ImageStorage = {
      downloadAndSave: vi.fn().mockRejectedValue(new Error("download failed")),
    };
    const handler = createPhotoMessageHandler({ replyBatcher, storage, logger: quietLogger });

    await handler(makeMessage());

    expect(replyBatcher.recordOutcome).toHaveBeenCalledWith("c1", "failure");
    expect(quietLogger.error).toHaveBeenCalled();
  });

  it("does nothing when the message has no photoUrl", async () => {
    const replyBatcher = makeReplyBatcher();
    const downloadAndSave = vi.fn();
    const handler = createPhotoMessageHandler({
      replyBatcher,
      storage: { downloadAndSave },
      logger: quietLogger,
    });

    await handler(makeMessage({ photoUrl: undefined }));

    expect(replyBatcher.recordOutcome).not.toHaveBeenCalled();
    expect(downloadAndSave).not.toHaveBeenCalled();
  });

  it("never throws even when downloadAndSave fails", async () => {
    const replyBatcher = makeReplyBatcher();
    const storage: ImageStorage = {
      downloadAndSave: vi.fn().mockRejectedValue(new Error("down")),
    };
    const handler = createPhotoMessageHandler({ replyBatcher, storage, logger: quietLogger });

    await expect(handler(makeMessage())).resolves.toBeUndefined();
  });
});
