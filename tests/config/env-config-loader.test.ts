import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config/env-config-loader";

const VALID_ENV = {
  BOT_TOKEN: "123:abc",
  WEBHOOK_SECRET: "a-valid-secret-16",
  SAVE_DIR: "./data/images",
};

describe("loadConfig", () => {
  it("returns a config with default port when all required vars are set", () => {
    const config = loadConfig(VALID_ENV);
    expect(config.botToken).toBe("123:abc");
    expect(config.webhookSecret).toBe("a-valid-secret-16");
    expect(config.saveDir).toBe(path.resolve("./data/images"));
    expect(config.port).toBe(3000);
  });

  it("uses PORT when provided", () => {
    const config = loadConfig({ ...VALID_ENV, PORT: "4321" });
    expect(config.port).toBe(4321);
  });

  it("throws listing all missing required variables", () => {
    expect(() => loadConfig({})).toThrowError(/BOT_TOKEN.*WEBHOOK_SECRET.*SAVE_DIR/s);
  });

  it("throws when WEBHOOK_SECRET is shorter than 8 chars", () => {
    expect(() => loadConfig({ ...VALID_ENV, WEBHOOK_SECRET: "short" })).toThrowError(
      /8-256 characters/,
    );
  });

  it("throws when WEBHOOK_SECRET exceeds 256 chars", () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, WEBHOOK_SECRET: "a".repeat(257) }),
    ).toThrowError(/8-256 characters/);
  });

  it("throws when PORT is not a valid integer in range", () => {
    expect(() => loadConfig({ ...VALID_ENV, PORT: "not-a-number" })).toThrowError(/PORT/);
    expect(() => loadConfig({ ...VALID_ENV, PORT: "0" })).toThrowError(/PORT/);
    expect(() => loadConfig({ ...VALID_ENV, PORT: "70000" })).toThrowError(/PORT/);
  });
});
