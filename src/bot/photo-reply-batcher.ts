import {
  isRetryableZaloSdkError,
  retryWithExponentialBackoff,
} from "../utils/retry-with-exponential-backoff";

export interface SendMessageOptions {
  reply_to_message_id?: string;
}

export interface BotMessenger {
  sendMessage(chatId: string, text: string, options?: SendMessageOptions): Promise<unknown>;
}

export interface PhotoReplyBatcher {
  /** Call when a photo's download starts — keeps the batch open until every started photo has resolved. */
  recordStart(chatId: string): void;
  /** Call once per photo that downloaded and saved successfully. */
  recordSuccess(chatId: string): void;
  /** Call once per photo that failed — messageId is reply-quoted so the user can tell which photo it was. */
  recordFailure(chatId: string, messageId: string): void;
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
export function buildSuccessSummaryText(successCount: number): string {
  return successCount === 1 ? SUCCESS_REPLY : `Đã lưu ${successCount} ảnh thành công ✅`;
}

/** Used only when there are too many failures to reply-quote individually (see MAX_INDIVIDUAL_FAILURE_REPLIES). */
export function buildCombinedFailureText(failureCount: number): string {
  return failureCount === 1
    ? FAILURE_REPLY
    : `Lưu ${failureCount} ảnh thất bại ❌ Vui lòng gửi lại các ảnh đó.`;
}

const DEFAULT_DEBOUNCE_MS = 2000;
// Replying to each failed photo individually (so Zalo shows it inline with
// the original image) only helps when there are a few — past this, quoting
// every one would spam the chat just as much as the thing this feature was
// built to avoid, so it falls back to a single combined count instead.
const MAX_INDIVIDUAL_FAILURE_REPLIES = 5;

interface PendingBatch {
  successCount: number;
  failedMessageIds: string[];
  /** Photos that have started downloading but not yet resolved (success or failure). */
  pendingStarts: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Zalo delivers each photo of a multi-image send as its own webhook event —
 * there is no album/media-group id in the payload — so sending N photos at
 * once fires N separate handler calls. Successes are coalesced per chatId
 * into one summary message after `debounceMs` of silence from that chat.
 * Failures are reply-quoted to the specific failed photo instead (up to
 * MAX_INDIVIDUAL_FAILURE_REPLIES) so the user knows which one to resend,
 * not just how many.
 *
 * `pendingStarts` exists because photo downloads retry at different speeds
 * (see image-download-and-save-service.ts's 202-retry handling) — in a
 * burst of ~20+ photos, one straggler can resolve several seconds after the
 * rest. Without tracking in-flight starts, the debounce timer fires on the
 * fast photos' silence alone, undercounts the batch, and the straggler ends
 * up in its own trailing reply — confusing ("why does it say 23 when I sent
 * 24?") even though nothing was actually lost. The flush only proceeds once
 * every started photo has resolved.
 *
 * Note: a pending batch still waiting on in-flight photos at process
 * shutdown is not flushed (not wired into server.ts's shutdown sequence) —
 * the photos are already safely on disk by then, only the confirmation
 * reply would be missed in that rare race.
 */
export function createPhotoReplyBatcher(opts: PhotoReplyBatcherOptions): PhotoReplyBatcher {
  const { messenger, debounceMs = DEFAULT_DEBOUNCE_MS, replyRetrySleep } = opts;
  const logger = opts.logger ?? console;
  const pending = new Map<string, PendingBatch>();

  async function sendWithRetry(
    chatId: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<void> {
    try {
      await retryWithExponentialBackoff(
        () =>
          messenger.sendMessage(
            chatId,
            text,
            replyToMessageId ? { reply_to_message_id: replyToMessageId } : undefined,
          ),
        { isRetryable: isRetryableZaloSdkError, sleep: replyRetrySleep },
      );
    } catch (error) {
      logger.error("[photo-reply-batcher] reply failed", {
        chatId,
        replyToMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function flush(chatId: string, batch: PendingBatch): Promise<void> {
    // A straggler is still mid-download/retry — leave the batch open. The
    // next recordSuccess/recordFailure call reschedules this timer anyway,
    // so nothing further needs to happen here.
    if (batch.pendingStarts > 0) return;

    pending.delete(chatId);

    if (batch.successCount > 0) {
      await sendWithRetry(chatId, buildSuccessSummaryText(batch.successCount));
    }

    if (batch.failedMessageIds.length === 0) return;

    if (batch.failedMessageIds.length > MAX_INDIVIDUAL_FAILURE_REPLIES) {
      await sendWithRetry(chatId, buildCombinedFailureText(batch.failedMessageIds.length));
      return;
    }

    for (const failedId of batch.failedMessageIds) {
      await sendWithRetry(chatId, FAILURE_REPLY, failedId);
    }
  }

  function getOrCreateBatch(chatId: string): PendingBatch {
    const existing = pending.get(chatId);
    if (existing) return existing;
    const batch: PendingBatch = {
      successCount: 0,
      failedMessageIds: [],
      pendingStarts: 0,
      timer: null,
    };
    pending.set(chatId, batch);
    return batch;
  }

  function rescheduleFlush(chatId: string, batch: PendingBatch): void {
    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => void flush(chatId, batch), debounceMs);
  }

  return {
    recordStart(chatId: string): void {
      const batch = getOrCreateBatch(chatId);
      batch.pendingStarts += 1;
      // Don't (re)schedule a flush here — there's nothing to report yet,
      // and an existing timer from an earlier-finished photo in this same
      // batch is left running; it'll see pendingStarts > 0 and no-op until
      // this photo resolves and reschedules it for real.
    },
    recordSuccess(chatId: string): void {
      const batch = getOrCreateBatch(chatId);
      batch.successCount += 1;
      batch.pendingStarts = Math.max(0, batch.pendingStarts - 1);
      rescheduleFlush(chatId, batch);
    },
    recordFailure(chatId: string, messageId: string): void {
      const batch = getOrCreateBatch(chatId);
      batch.failedMessageIds.push(messageId);
      batch.pendingStarts = Math.max(0, batch.pendingStarts - 1);
      rescheduleFlush(chatId, batch);
    },
  };
}
