import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPhotoMessageHandler,
  FAILURE_REPLY,
  SUCCESS_REPLY,
  type PhotoMessageLike,
} from "../../src/bot/photo-message-handler";
import type { ImageStorage } from "../../src/storage/image-download-and-save-service";

function makeMessage(overrides: Partial<PhotoMessageLike> = {}): PhotoMessageLike {
  return { messageId: "m1", chat: { id: "c1" }, photoUrl: "https://x/y.jpg", ...overrides };
}

const quietLogger = { info: vi.fn(), error: vi.fn() };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPhotoMessageHandler", () => {
  it("sends the success reply after a successful download", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const storage: ImageStorage = {
      downloadAndSave: vi.fn().mockResolvedValue({ filePath: "/x", fileName: "x.jpg", bytes: 1 }),
    };
    const handler = createPhotoMessageHandler({
      messenger: { sendMessage },
      storage,
      logger: quietLogger,
    });

    await handler(makeMessage());

    expect(sendMessage).toHaveBeenCalledWith("c1", SUCCESS_REPLY);
  });

  it("sends the failure reply and logs when storage throws", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const storage: ImageStorage = {
      downloadAndSave: vi.fn().mockRejectedValue(new Error("download failed")),
    };
    const handler = createPhotoMessageHandler({
      messenger: { sendMessage },
      storage,
      logger: quietLogger,
    });

    await handler(makeMessage());

    expect(sendMessage).toHaveBeenCalledWith("c1", FAILURE_REPLY);
    expect(quietLogger.error).toHaveBeenCalled();
  });

  it("does nothing when the message has no photoUrl", async () => {
    const sendMessage = vi.fn();
    const downloadAndSave = vi.fn();
    const handler = createPhotoMessageHandler({
      messenger: { sendMessage },
      storage: { downloadAndSave },
      logger: quietLogger,
    });

    await handler(makeMessage({ photoUrl: undefined }));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(downloadAndSave).not.toHaveBeenCalled();
  });

  it("retries a transient sendMessage failure named NetworkError then succeeds", async () => {
    const networkError = new Error("temporary");
    networkError.name = "NetworkError";
    const sendMessage = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValue(undefined);
    const storage: ImageStorage = {
      downloadAndSave: vi.fn().mockResolvedValue({ filePath: "/x", fileName: "x.jpg", bytes: 1 }),
    };
    const handler = createPhotoMessageHandler({
      messenger: { sendMessage },
      storage,
      logger: quietLogger,
      replyRetrySleep: async () => {},
    });

    await handler(makeMessage());

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("never throws even when sendMessage fails on every attempt", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("down"));
    const storage: ImageStorage = {
      downloadAndSave: vi.fn().mockResolvedValue({ filePath: "/x", fileName: "x.jpg", bytes: 1 }),
    };
    const handler = createPhotoMessageHandler({
      messenger: { sendMessage },
      storage,
      logger: quietLogger,
      replyRetrySleep: async () => {},
    });

    await expect(handler(makeMessage())).resolves.toBeUndefined();
  });
});
