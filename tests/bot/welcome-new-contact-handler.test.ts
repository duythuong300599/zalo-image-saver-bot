import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWelcomeNewContactHandler,
  WELCOME_TEXT,
  type MessageWithChat,
} from "../../src/bot/welcome-new-contact-handler";
import type { KnownChatStore } from "../../src/bot/known-chat-store";
import type { BotMessenger } from "../../src/bot/photo-reply-batcher";

const quietLogger = { error: vi.fn() };

afterEach(() => {
  vi.restoreAllMocks();
});

function makeMessage(chatId = "c1"): MessageWithChat {
  return { chat: { id: chatId } };
}

describe("createWelcomeNewContactHandler", () => {
  it("sends the welcome text on first contact", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const knownChatStore: KnownChatStore = { isFirstContact: vi.fn().mockResolvedValue(true) };
    const handler = createWelcomeNewContactHandler({
      messenger: { sendMessage },
      knownChatStore,
      logger: quietLogger,
    });

    await handler(makeMessage());

    expect(sendMessage).toHaveBeenCalledWith("c1", WELCOME_TEXT);
  });

  it("does nothing for a chat that has already been welcomed", async () => {
    const sendMessage = vi.fn();
    const knownChatStore: KnownChatStore = { isFirstContact: vi.fn().mockResolvedValue(false) };
    const handler = createWelcomeNewContactHandler({ messenger: { sendMessage }, knownChatStore });

    await handler(makeMessage());

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("logs instead of throwing when sendMessage keeps failing", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("down"));
    const knownChatStore: KnownChatStore = { isFirstContact: vi.fn().mockResolvedValue(true) };
    const handler = createWelcomeNewContactHandler({
      messenger: { sendMessage },
      knownChatStore,
      logger: quietLogger,
      replyRetrySleep: async () => {},
    });

    await expect(handler(makeMessage())).resolves.toBeUndefined();
    expect(quietLogger.error).toHaveBeenCalled();
  });

  it("retries a transient sendMessage failure then succeeds", async () => {
    const networkError = new Error("temporary");
    networkError.name = "NetworkError";
    const sendMessage = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValue(undefined);
    const knownChatStore: KnownChatStore = { isFirstContact: vi.fn().mockResolvedValue(true) };
    const handler = createWelcomeNewContactHandler({
      messenger: { sendMessage } satisfies BotMessenger,
      knownChatStore,
      replyRetrySleep: async () => {},
    });

    await handler(makeMessage());

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
