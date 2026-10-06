import { Bot } from "zalo-bot-js";

import type { AppConfig } from "../config/env-config-loader";
import type { ImageStorage } from "../storage/image-download-and-save-service";
import { createPhotoMessageHandler } from "./photo-message-handler";

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

  bot.on("photo", createPhotoMessageHandler({ messenger: bot, storage }));

  return bot;
}
