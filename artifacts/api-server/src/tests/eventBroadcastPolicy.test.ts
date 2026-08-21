import { describe, expect, it } from "vitest";
import {
  EVENT_BROADCAST_COOLDOWN_MS,
  EVENT_BROADCAST_MAX_PER_WINDOW,
  eligibleEventBroadcastRecipientIds,
  evaluateEventBroadcastRateLimit,
  summarizeEventBroadcastDeliveries,
} from "../lib/eventBroadcastPolicy";

describe("eligibleEventBroadcastRecipientIds", () => {
  const activeGoing = {
    rsvpStatus: "going",
    isPrivate: false,
    accountStatus: "active",
    memberStatus: "active",
  };

  it("keeps only confirmed, public, active, unblocked attendees", () => {
    const recipients = eligibleEventBroadcastRecipientIds(
      [
        { userId: 1, ...activeGoing },
        { userId: 2, ...activeGoing, rsvpStatus: "waitlisted" },
        { userId: 3, ...activeGoing, isPrivate: true },
        { userId: 4, ...activeGoing, accountStatus: "suspended" },
        { userId: 5, ...activeGoing, memberStatus: "removed" },
        { userId: 6, ...activeGoing },
        { userId: 7, ...activeGoing, rsvpStatus: "cancelled" },
        { userId: 8, ...activeGoing },
        { userId: 8, ...activeGoing },
      ],
      1,
      new Set([6]),
    );

    expect(recipients).toEqual([8]);
  });
});

describe("evaluateEventBroadcastRateLimit", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  it("enforces the cooldown after a recent send", () => {
    const result = evaluateEventBroadcastRateLimit(
      1,
      new Date(now.getTime() - EVENT_BROADCAST_COOLDOWN_MS + 30_000),
      new Date(now.getTime() - EVENT_BROADCAST_COOLDOWN_MS + 30_000),
      now,
    );

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  it("enforces the hourly cap", () => {
    const result = evaluateEventBroadcastRateLimit(
      EVENT_BROADCAST_MAX_PER_WINDOW,
      new Date(now.getTime() - 45 * 60 * 1000),
      new Date(now.getTime() - EVENT_BROADCAST_COOLDOWN_MS - 1),
      now,
    );

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 15 * 60 });
  });

  it("allows a send when neither limit applies", () => {
    expect(
      evaluateEventBroadcastRateLimit(
        EVENT_BROADCAST_MAX_PER_WINDOW - 1,
        new Date(now.getTime() - EVENT_BROADCAST_COOLDOWN_MS - 1),
        new Date(now.getTime() - EVENT_BROADCAST_COOLDOWN_MS - 1),
        now,
      ),
    ).toEqual({ allowed: true });
  });
});

describe("summarizeEventBroadcastDeliveries", () => {
  it("reports partial delivery clearly", () => {
    expect(
      summarizeEventBroadcastDeliveries(["delivered", "failed", "delivered"]),
    ).toEqual({
      status: "partial",
      recipientCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      skippedCount: 0,
    });
  });

  it("reports an empty eligible audience without claiming delivery", () => {
    expect(summarizeEventBroadcastDeliveries([])).toEqual({
      status: "no_recipients",
      recipientCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      skippedCount: 0,
    });
  });

  it("does not count attendees who became ineligible as recipients", () => {
    expect(summarizeEventBroadcastDeliveries(["delivered", "skipped"])).toEqual({
      status: "sent",
      recipientCount: 1,
      deliveredCount: 1,
      failedCount: 0,
      skippedCount: 1,
    });
  });
});