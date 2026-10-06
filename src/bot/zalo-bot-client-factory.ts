import { Bot } from "zalo-bot-js";

import type { AppConfig } from "../config/env-config-loader";
import type { ImageStorage } from "../storage/image-download-and-save-service";
import { createKnownChatStore } from "./known-chat-store";
import { createPhotoMessageHandler } from "./photo-message-handler";
import { createPhotoReplyBatcher } from "./photo-reply-batcher";
import { createWelcomeNewContactHandler } from "./welcome-new-contact-handler";

/** Minimal surface the Express layer needs — keeps the webhook route decoupled from the SDK type. */
export interface WebhookBot {
  processUpdate(payload: unknown): Promise<void>;
}

/**
 * Wraps the SDK's `Bot` behind our own small interfaces (WebhookBot,
 * BotMessenger) so a future SDK major-version bump only requires changes
 * here, not across the app.
 */
export function createZaloBot(config: AppConfig, storage: ImageStorage): Bot {
  const bot = new Bot({
    token: config.botToken,
    onError: (error: unknown, ctx: { kind?: string }) => {
      console.error("[zalo-bot]", ctx?.kind, error instanceof Error ? error.message : error);
    },
  });

  const knownChatStore = createKnownChatStore(config.saveDir);
  bot.on("message", createWelcomeNewContactHandler({ messenger: bot, knownChatStore }));

  const replyBatcher = createPhotoReplyBatcher({ messenger: bot });
  bot.on("photo", createPhotoMessageHandler({ replyBatcher, storage }));

  return bot;
}
