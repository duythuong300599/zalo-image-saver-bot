import {
  isRetryableZaloSdkError,
  retryWithExponentialBackoff,
} from "../utils/retry-with-exponential-backoff";
import type { KnownChatStore } from "./known-chat-store";
import type { BotMessenger } from "./photo-reply-batcher";

export const WELCOME_TEXT =
  "Chào bạn 👋 Mình là bot tự động lưu ảnh. Cứ gửi ảnh cho mình, mình sẽ lưu lại và báo kết quả ngay sau đó.";

export interface MessageWithChat {
  chat: { id: string };
}

export interface WelcomeNewContactHandlerDeps {
  messenger: BotMessenger;
  knownChatStore: KnownChatStore;
  logger?: Pick<Console, "error">;
  /** Injectable retry delay fn — lets tests skip real waits between retry attempts. */
  replyRetrySleep?: (ms: number) => Promise<void>;
}

/**
 * Wired to the SDK's "message" event, which fires for every incoming
 * message type (text, photo, sticker, voice) — unlike "photo", which only
 * fires when a photo is attached. That makes it the right hook to catch a
 * chat's very first message regardless of what kind it is. The Zalo Bot
 * Platform has no dedicated follow/start event to use instead.
 */
export function createWelcomeNewContactHandler(
  deps: WelcomeNewContactHandlerDeps,
): (message: MessageWithChat) => Promise<void> {
  const logger = deps.logger ?? console;

  return async (message: MessageWithChat): Promise<void> => {
    const chatId = message.chat.id;
    const isFirstContact = await deps.knownChatStore.isFirstContact(chatId);
    if (!isFirstContact) return;

    try {
      await retryWithExponentialBackoff(() => deps.messenger.sendMessage(chatId, WELCOME_TEXT), {
        isRetryable: isRetryableZaloSdkError,
        sleep: deps.replyRetrySleep,
      });
    } catch (error) {
      logger.error("[welcome-new-contact-handler] failed to send welcome", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
