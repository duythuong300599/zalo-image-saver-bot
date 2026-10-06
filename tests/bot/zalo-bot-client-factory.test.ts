import { afterEach, describe, expect, it, vi } from "vitest";

import { createZaloBot } from "../../src/bot/zalo-bot-client-factory";
import type { AppConfig } from "../../src/config/env-config-loader";
import type { ImageStorage } from "../../src/storage/image-download-and-save-service";
import { Bot as StubBot } from "../test-doubles/zalo-bot-js-stub";

afterEach(() => {
  vi.restoreAllMocks();
  StubBot.reset();
});

const config: AppConfig = {
  botToken: "test-token",
  webhookSecret: "a-very-long-webhook-secret",
  saveDir: "/tmp/save",
  port: 3000,
};

function makeStorage(): ImageStorage {
  return { downloadAndSave: vi.fn().mockResolvedValue({ filePath: "/x", fileName: "x.jpg", bytes: 1 }) };
}

describe("createZaloBot", () => {
  it("constructs the SDK Bot with the configured token", () => {
    createZaloBot(config, makeStorage());

    expect(StubBot.instances).toHaveLength(1);
    expect(StubBot.instances[0].options.token).toBe("test-token");
  });

  it("registers a photo handler on the bot instance", () => {
    createZaloBot(config, makeStorage());

    expect(StubBot.instances[0].handlers.has("photo")).toBe(true);
    expect(typeof StubBot.instances[0].handlers.get("photo")).toBe("function");
  });

  it("logs via console.error when the SDK reports an error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    createZaloBot(config, makeStorage());
    StubBot.instances[0].options.onError?.(new Error("boom"), { kind: "webhook" });

    expect(errorSpy).toHaveBeenCalledWith("[zalo-bot]", "webhook", "boom");
  });

  it("logs the raw error value when it is not an Error instance", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    createZaloBot(config, makeStorage());
    StubBot.instances[0].options.onError?.("not-an-error", {});

    expect(errorSpy).toHaveBeenCalledWith("[zalo-bot]", undefined, "not-an-error");
  });
});
