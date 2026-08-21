export const EVENT_BROADCAST_COOLDOWN_MS = 5 * 60 * 1000;
export const EVENT_BROADCAST_WINDOW_MS = 60 * 60 * 1000;
export const EVENT_BROADCAST_MAX_PER_WINDOW = 3;

export type EventBroadcastCandidate = {
  userId: number;
  rsvpStatus: string;
  isPrivate: boolean;
  accountStatus: string;
  memberStatus: string | null;
};

export function eligibleEventBroadcastRecipientIds(
  candidates: EventBroadcastCandidate[],
  senderUserId: number,
  blockedUserIds: ReadonlySet<number>,
): number[] {
  const eligible = new Set<number>();

  for (const candidate of candidates) {
    if (
      candidate.userId !== senderUserId &&
      candidate.rsvpStatus === "going" &&
      candidate.isPrivate === false &&
      candidate.accountStatus === "active" &&
      candidate.memberStatus === "active" &&
      !blockedUserIds.has(candidate.userId)
    ) {
      eligible.add(candidate.userId);
    }
  }

  return [...eligible];
}

export function evaluateEventBroadcastRateLimit(
  attemptsInWindow: number,
  oldestAttemptAt: Date | null,
  latestAttemptAt: Date | null,
  now = new Date(),
):
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number } {
  const windowRetryMs =
    oldestAttemptAt && attemptsInWindow >= EVENT_BROADCAST_MAX_PER_WINDOW
      ? oldestAttemptAt.getTime() + EVENT_BROADCAST_WINDOW_MS - now.getTime()
      : 0;
  const cooldownRetryMs = latestAttemptAt
    ? latestAttemptAt.getTime() + EVENT_BROADCAST_COOLDOWN_MS - now.getTime()
    : 0;
  const retryMs = Math.max(windowRetryMs, cooldownRetryMs);

  if (retryMs > 0) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
    };
  }

  return { allowed: true };
}

export function summarizeEventBroadcastDeliveries(
  outcomes: Array<"delivered" | "skipped" | "failed">,
): {
  status: "sent" | "partial" | "failed" | "no_recipients";
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  skippedCount: number;
} {
  const deliveredCount = outcomes.filter((outcome) => outcome === "delivered").length;
  const failedCount = outcomes.filter((outcome) => outcome === "failed").length;
  const skippedCount = outcomes.filter((outcome) => outcome === "skipped").length;
  const recipientCount = deliveredCount + failedCount;
  const status =
    recipientCount === 0
      ? "no_recipients"
      : failedCount === 0
        ? "sent"
        : deliveredCount === 0
          ? "failed"
          : "partial";

  return { status, recipientCount, deliveredCount, failedCount, skippedCount };
}