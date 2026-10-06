import {
  isRetryableZaloSdkError,
  retryWithExponentialBackoff,
} from "../utils/retry-with-exponential-backoff";
import type { ImageStorage } from "../storage/image-download-and-save-service";

export interface BotMessenger {
  sendMessage(chatId: string, text: string): Promise<unknown>;
}

export interface PhotoMessageLike {
  messageId: string;
  chat: { id: string };
  photoUrl?: string;
}

export const SUCCESS_REPLY = "Đã lưu ảnh thành công ✅";
export const FAILURE_REPLY = "Lưu ảnh thất bại ❌ Vui lòng gửi lại ảnh.";

export interface PhotoMessageHandlerDeps {
  messenger: BotMessenger;
  storage: ImageStorage;
  logger?: Pick<Console, "info" | "error">;
  /** Injectable retry delay fn — lets tests skip real waits between retry attempts. */
  replyRetrySleep?: (ms: number) => Promise<void>;
}

/** Best-effort reply: retries transient SDK errors, but a final failure only logs — never throws. */
async function replyWithRetry(
  deps: PhotoMessageHandlerDeps,
  chatId: string,
  text: string,
): Promise<void> {
  try {
    await retryWithExponentialBackoff(() => deps.messenger.sendMessage(chatId, text), {
      isRetryable: isRetryableZaloSdkError,
      sleep: deps.replyRetrySleep,
    });
  } catch (error) {
    (deps.logger ?? console).error("[photo-message-handler] reply failed", {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function createPhotoMessageHandler(
  deps: PhotoMessageHandlerDeps,
): (message: PhotoMessageLike) => Promise<void> {
  const logger = deps.logger ?? console;

  return async (message: PhotoMessageLike): Promise<void> => {
    if (!message.photoUrl) return;

    const chatId = message.chat.id;
    try {
      const saved = await deps.storage.downloadAndSave(message.photoUrl, message.messageId);
      logger.info("[photo-message-handler] saved", {
        messageId: message.messageId,
        chatId,
        fileName: saved.fileName,
        bytes: saved.bytes,
      });
      await replyWithRetry(deps, chatId, SUCCESS_REPLY);
    } catch (error) {
      const status = error instanceof Error && "status" in error ? error.status : undefined;
      logger.error("[photo-message-handler] failed", {
        messageId: message.messageId,
        chatId,
        error: error instanceof Error ? error.message : String(error),
        status,
      });
      await replyWithRetry(deps, chatId, FAILURE_REPLY);
    }
  };
}
