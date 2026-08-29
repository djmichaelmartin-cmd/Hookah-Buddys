import { and, eq, lt } from "drizzle-orm";
import {
  creditTransactionsTable,
  customContentRequestsTable,
  db,
} from "@workspace/db";
import { restoreHeldCredits } from "./credits";
import { createNotification } from "./notify";

/** Refund overdue holds exactly once; request rows and balances are locked together. */
export async function reconcileCustomRequestDeadlines(): Promise<void> {
  const now = new Date();
  const overdue = await db
    .select({ id: customContentRequestsTable.id })
    .from(customContentRequestsTable)
    .where(
      and(
        eq(customContentRequestsTable.holdStatus, "held"),
        // Either an unanswered request or an accepted request whose delivery window elapsed.
        lt(customContentRequestsTable.responseDeadlineAt, now),
      ),
    );
  for (const candidate of overdue) {
    try {
      const refunded = await db.transaction(async (tx) => {
        const [request] = await tx
          .select()
          .from(customContentRequestsTable)
          .where(eq(customContentRequestsTable.id, candidate.id))
          .for("update");
        if (!request || request.holdStatus !== "held") return null;
        const acceptedExpired =
          request.status === "accepted" || request.status === "in_progress";
        const pendingExpired =
          request.status === "pending_creator_response" &&
          request.responseDeadlineAt < now;
        if (
          !pendingExpired &&
          !(
            acceptedExpired &&
            request.deliveryDeadlineAt &&
            request.deliveryDeadlineAt < now
          )
        )
          return null;
        await restoreHeldCredits(tx, request.customerUserId, {
          membershipCredits: request.heldMembershipCredits,
          purchasedCredits: request.heldPurchasedCredits,
        });
        await tx
          .update(customContentRequestsTable)
          .set({
            status: pendingExpired ? "expired_no_response" : "failed_delivery",
            holdStatus: "refunded",
            refundedAt: now,
          })
          .where(eq(customContentRequestsTable.id, request.id));
        await tx.insert(creditTransactionsTable).values({
          userId: request.customerUserId,
          amount: request.priceCredits,
          type: "refund",
          description: "Refunded expired custom request",
          customContentRequestId: request.id,
          dollId: request.dollId,
        });
        return { ...request, pendingExpired };
      });
      if (refunded) {
        try {
          await createNotification({
            userId: refunded.customerUserId,
            type: "custom_request_refunded",
            title: "Custom request refunded",
            message: refunded.pendingExpired
              ? "The creator did not respond in time."
              : "The delivery deadline passed.",
            relatedUserId: refunded.creatorUserId,
          });
          await createNotification({
            userId: refunded.creatorUserId,
            type: "custom_request_expired",
            title: "Custom request expired",
            message: "The request was refunded to the member.",
            relatedUserId: refunded.customerUserId,
          });
        } catch {
          // Notifications are best-effort; a delivery failure must not stop reconciliation.
        }
      }
    } catch {
      // Process remaining candidates even if one transaction fails.
    }
  }
}

let timer: NodeJS.Timeout | undefined;
export function startCustomRequestReconciliation(): void {
  if (timer) return;
  timer = setInterval(() => {
    void reconcileCustomRequestDeadlines();
  }, 60_000);
  timer.unref();
  void reconcileCustomRequestDeadlines();
}
