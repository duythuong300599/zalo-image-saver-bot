import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { createPhotoMessageHandler, type PhotoMessageLike } from "../../src/bot/photo-message-handler";
import type { PhotoReplyBatcher } from "../../src/bot/photo-reply-batcher";
import type { ImageStorage } from "../../src/storage/image-download-and-save-service";

function makeMessage(overrides: Partial<PhotoMessageLike> = {}): PhotoMessageLike {
  return { messageId: "m1", chat: { id: "c1" }, photoUrl: "https://x/y.jpg", ...overrides };
}

function makeReplyBatcher(): PhotoReplyBatcher & {
  recordStart: Mock<PhotoReplyBatcher["recordStart"]>;
  recordSuccess: Mock<PhotoReplyBatcher["recordSuccess"]>;
  recordFailure: Mock<PhotoReplyBatcher["recordFailure"]>;
} {
  return { recordStart: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() };
}

const quietLogger = { info: vi.fn(), error: vi.fn() };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPhotoMessageHandler", () => {
  it("records a success after a successful download", async () => {
    const replyBatcher = makeReplyBatcher();
    const storage: ImageStorage = {
      downloadAndSave: vi.fn().mockResolvedValue({ filePath: "/x", fileName: "x.jpg", bytes: 1 }),
    };
    const handler = createPhotoMessageHandler({ replyBatcher, storage, logger: quietLogger });

    await handler(makeMessage());

    expect(replyBatcher.recordStart).toHaveBeenCalledWith("c1");
    expect(replyBatcher.recordSuccess).toHaveBeenCalledWith("c1");
    expect(replyBatcher.recordFailure).not.toHaveBeenCalled();
  });

  it("records a failure (with the messageId, for reply-quoting) and logs when storage throws", async () => {
    const replyBatcher = makeReplyBatcher();
    const storage: ImageStorage = {
      downloadAndSave: vi.fn().mockRejectedValue(new Error("download failed")),
    };
    const handler = createPhotoMessageHandler({ replyBatcher, storage, logger: quietLogger });

    await handler(makeMessage({ messageId: "m1" }));

    expect(replyBatcher.recordFailure).toHaveBeenCalledWith("c1", "m1");
    expect(replyBatcher.recordSuccess).not.toHaveBeenCalled();
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

    expect(replyBatcher.recordStart).not.toHaveBeenCalled();
    expect(replyBatcher.recordSuccess).not.toHaveBeenCalled();
    expect(replyBatcher.recordFailure).not.toHaveBeenCalled();
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
