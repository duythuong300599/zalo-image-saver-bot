import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createKnownChatStore } from "../../src/bot/known-chat-store";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zisb-known-chats-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("createKnownChatStore", () => {
  it("returns true the first time a chatId is seen, false on every later call", async () => {
    const store = createKnownChatStore(tmpDir);

    await expect(store.isFirstContact("c1")).resolves.toBe(true);
    await expect(store.isFirstContact("c1")).resolves.toBe(false);
    await expect(store.isFirstContact("c1")).resolves.toBe(false);
  });

  it("tracks each chatId independently", async () => {
    const store = createKnownChatStore(tmpDir);

    await expect(store.isFirstContact("c1")).resolves.toBe(true);
    await expect(store.isFirstContact("c2")).resolves.toBe(true);
    await expect(store.isFirstContact("c1")).resolves.toBe(false);
  });

  it("persists known chats to disk so a new store instance (simulating a restart) remembers them", async () => {
    const first = createKnownChatStore(tmpDir);
    await first.isFirstContact("c1");

    const afterRestart = createKnownChatStore(tmpDir);
    await expect(afterRestart.isFirstContact("c1")).resolves.toBe(false);
    await expect(afterRestart.isFirstContact("c2")).resolves.toBe(true);
  });

  it("starts fresh instead of throwing when the state file is missing", async () => {
    const store = createKnownChatStore(path.join(tmpDir, "never-written-to"));
    await expect(store.isFirstContact("c1")).resolves.toBe(true);
  });

  it("starts fresh instead of throwing when the state file contains corrupt JSON", async () => {
    await fs.writeFile(path.join(tmpDir, ".known-chats.json"), "{not-json", "utf8");
    const store = createKnownChatStore(tmpDir);
    await expect(store.isFirstContact("c1")).resolves.toBe(true);
  });

  it("resolves two concurrent first-contact calls for the same chatId as [true, false]", async () => {
    const store = createKnownChatStore(tmpDir);

    const [a, b] = await Promise.all([store.isFirstContact("c1"), store.isFirstContact("c1")]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});
