import type { ImageStorage } from "../storage/image-download-and-save-service";
import type { PhotoReplyBatcher } from "./photo-reply-batcher";

export interface PhotoMessageLike {
  messageId: string;
  chat: { id: string };
  photoUrl?: string;
}

export interface PhotoMessageHandlerDeps {
  replyBatcher: PhotoReplyBatcher;
  storage: ImageStorage;
  logger?: Pick<Console, "info" | "error">;
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
      deps.replyBatcher.recordSuccess(chatId);
    } catch (error) {
      const status = error instanceof Error && "status" in error ? error.status : undefined;
      logger.error("[photo-message-handler] failed", {
        messageId: message.messageId,
        chatId,
        photoUrl: message.photoUrl,
        error: error instanceof Error ? error.message : String(error),
        status,
      });
      deps.replyBatcher.recordFailure(chatId, message.messageId);
    }
  };
}
