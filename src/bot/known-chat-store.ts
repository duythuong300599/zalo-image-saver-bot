import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface KnownChatStore {
  /** True and records chatId the first time it's seen; false on every later call for the same chatId. */
  isFirstContact(chatId: string): Promise<boolean>;
}

const STATE_FILE_NAME = ".known-chats.json";

/**
 * Persisted as a JSON array inside SAVE_DIR itself — in production that's
 * the only writable path (docker-compose mounts just SAVE_DIR and the
 * container root is `read_only: true`), so storing state here means the
 * "welcome once" behavior survives container restarts without a new volume.
 */
export function createKnownChatStore(saveDir: string): KnownChatStore {
  const filePath = path.join(saveDir, STATE_FILE_NAME);
  let loadPromise: Promise<Set<string>> | null = null;
  let writeQueue: Promise<void> = Promise.resolve();

  function load(): Promise<Set<string>> {
    loadPromise ??= readFile(filePath, "utf8")
      .then((raw) => new Set(JSON.parse(raw) as string[]))
      .catch(() => new Set<string>()); // missing/corrupt file — start fresh rather than fail the request
    return loadPromise;
  }

  function persist(chats: Set<string>): Promise<void> {
    writeQueue = writeQueue.then(() =>
      writeFile(filePath, JSON.stringify([...chats]), "utf8").catch((error: unknown) => {
        console.error("[known-chat-store] failed to persist", error);
      }),
    );
    return writeQueue;
  }

  return {
    async isFirstContact(chatId: string): Promise<boolean> {
      const chats = await load();
      // No `await` between this check and the `.add()` below — Node's
      // run-to-completion semantics make this safe against two concurrent
      // calls for the same chatId both seeing "not known yet".
      if (chats.has(chatId)) return false;
      chats.add(chatId);
      await persist(chats);
      return true;
    },
  };
}
