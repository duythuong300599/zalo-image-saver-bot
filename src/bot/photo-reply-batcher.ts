import {
  isRetryableZaloSdkError,
  retryWithExponentialBackoff,
} from "../utils/retry-with-exponential-backoff";

export interface BotMessenger {
  sendMessage(chatId: string, text: string): Promise<unknown>;
}

export type PhotoOutcome = "success" | "failure";

export interface PhotoReplyBatcher {
  /** Call once per processed photo (success or failure) for a chat. */
  recordOutcome(chatId: string, outcome: PhotoOutcome): void;
}

export interface PhotoReplyBatcherOptions {
  messenger: BotMessenger;
  /** Quiet period after the last photo in a burst before replying once. */
  debounceMs?: number;
  logger?: Pick<Console, "error">;
  /** Injectable retry delay fn — lets tests skip real waits between retry attempts. */
  replyRetrySleep?: (ms: number) => Promise<void>;
}

export const SUCCESS_REPLY = "Đã lưu ảnh thành công ✅";
export const FAILURE_REPLY = "Lưu ảnh thất bại ❌ Vui lòng gửi lại ảnh.";

/** Pure so the wording can be unit-tested without touching timers or the messenger. */
export function buildBatchReplyText(successCount: number, failureCount: number): string {
  if (failureCount === 0) {
    return successCount === 1 ? SUCCESS_REPLY : `Đã lưu ${successCount} ảnh thành công ✅`;
  }
  if (successCount === 0) {
    return failureCount === 1
      ? FAILURE_REPLY
      : `Lưu ${failureCount} ảnh thất bại ❌ Vui lòng gửi lại các ảnh đó.`;
  }
  return `Đã lưu ${successCount} ảnh thành công ✅, ${failureCount} ảnh lỗi ❌ vui lòng gửi lại ảnh lỗi.`;
}

const DEFAULT_DEBOUNCE_MS = 2000;

interface PendingBatch {
  successCount: number;
  failureCount: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Zalo delivers each photo of a multi-image send as its own webhook event —
 * there is no album/media-group id in the payload — so sending 5 photos at
 * once fires 5 separate handler calls. Replying to each individually would
 * spam the chat, so outcomes are coalesced per chatId and flushed as one
 * message after `debounceMs` of silence from that chat.
 *
 * Note: a pending batch still in its debounce window at process shutdown is
 * not flushed (not wired into server.ts's shutdown sequence) — the photos
 * are already safely on disk by then, only the confirmation reply would be
 * missed in that rare race.
 */
export function createPhotoReplyBatcher(opts: PhotoReplyBatcherOptions): PhotoReplyBatcher {
  const { messenger, debounceMs = DEFAULT_DEBOUNCE_MS, replyRetrySleep } = opts;
  const logger = opts.logger ?? console;
  const pending = new Map<string, PendingBatch>();

  async function flush(chatId: string, batch: PendingBatch): Promise<void> {
    pending.delete(chatId);
    const text = buildBatchReplyText(batch.successCount, batch.failureCount);
    try {
      await retryWithExponentialBackoff(() => messenger.sendMessage(chatId, text), {
        isRetryable: isRetryableZaloSdkError,
        sleep: replyRetrySleep,
      });
    } catch (error) {
      logger.error("[photo-reply-batcher] reply failed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    recordOutcome(chatId: string, outcome: PhotoOutcome): void {
      const existing = pending.get(chatId);
      if (existing) {
        clearTimeout(existing.timer);
        if (outcome === "success") existing.successCount += 1;
        else existing.failureCount += 1;
        existing.timer = setTimeout(() => void flush(chatId, existing), debounceMs);
        return;
      }
      const batch: PendingBatch = {
        successCount: outcome === "success" ? 1 : 0,
        failureCount: outcome === "failure" ? 1 : 0,
        timer: setTimeout(() => void flush(chatId, batch), debounceMs),
      };
      pending.set(chatId, batch);
    },
  };
}
