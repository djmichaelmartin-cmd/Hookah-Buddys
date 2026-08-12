import { and, eq, gt, inArray, lte } from "drizzle-orm";
import {
  db,
  eventsTable,
  eventRsvpsTable,
  eventReminderSendsTable,
  type Event,
} from "@workspace/db";
import { createNotification } from "./notify";
import { logger } from "./logger";

const HOUR_MS = 60 * 60 * 1000;

function formatStartsAt(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function eventPlace(event: Event): string {
  const venue = event.venueName ? `${event.venueName}, ` : "";
  return `${venue}${event.city}, ${event.state}`;
}

/**
 * Record a send in the dedupe ledger and create the notification only when
 * this is the first time (event, user, kind) is seen. Safe to call repeatedly.
 */
async function sendOnce(
  eventId: number,
  userId: number,
  kind: string,
  notification: { type: string; title: string; message: string },
): Promise<boolean> {
  const inserted = await db
    .insert(eventReminderSendsTable)
    .values({ eventId, userId, kind })
    .onConflictDoNothing()
    .returning({ id: eventReminderSendsTable.id });
  if (inserted.length === 0) return false;
  await createNotification({ userId, ...notification });
  return true;
}

/**
 * Send ~24h and ~1h reminders to users who RSVP'd to upcoming active events.
 * Idempotent across repeated runs via the event_reminder_sends ledger.
 */
export async function sendEventReminders(now: Date = new Date()): Promise<void> {
  const in24h = new Date(now.getTime() + 24 * HOUR_MS);
  const events = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.status, "active"),
        gt(eventsTable.startsAt, now),
        lte(eventsTable.startsAt, in24h),
      ),
    );
  if (events.length === 0) return;

  const rsvps = await db
    .select({ eventId: eventRsvpsTable.eventId, userId: eventRsvpsTable.userId })
    .from(eventRsvpsTable)
    .where(inArray(eventRsvpsTable.eventId, events.map((e) => e.id)));
  if (rsvps.length === 0) return;

  const eventById = new Map(events.map((e) => [e.id, e]));
  let sent = 0;
  for (const rsvp of rsvps) {
    const event = eventById.get(rsvp.eventId);
    if (!event) continue;
    const startsInMs = event.startsAt.getTime() - now.getTime();
    const kind = startsInMs <= HOUR_MS ? "1h" : "24h";
    const when =
      kind === "1h"
        ? "starts in less than an hour"
        : `starts ${formatStartsAt(event.startsAt)}`;
    try {
      const didSend = await sendOnce(event.id, rsvp.userId, kind, {
        type: "event_reminder",
        title: kind === "1h" ? "Starting soon" : "Event reminder",
        message: `"${event.title}" ${when} at ${eventPlace(event)}. You RSVP'd — see you there!`,
      });
      if (didSend) sent++;
    } catch (err) {
      logger.error({ err, eventId: event.id, userId: rsvp.userId }, "event reminder send failed");
    }
  }
  if (sent > 0) logger.info({ sent }, "event reminders sent");
}

/**
 * Notify everyone who RSVP'd that an event was cancelled (or removed).
 * Deduped via the ledger, so repeated cancel edits don't re-notify.
 */
export async function notifyEventCancelled(event: Event): Promise<void> {
  const rsvps = await db
    .select({ userId: eventRsvpsTable.userId })
    .from(eventRsvpsTable)
    .where(eq(eventRsvpsTable.eventId, event.id));
  for (const rsvp of rsvps) {
    try {
      await sendOnce(event.id, rsvp.userId, "cancelled", {
        type: "event_cancelled",
        title: "Event cancelled",
        message: `"${event.title}" on ${formatStartsAt(event.startsAt)} at ${eventPlace(event)} has been cancelled.`,
      });
    } catch (err) {
      logger.error({ err, eventId: event.id, userId: rsvp.userId }, "event cancel notify failed");
    }
  }
}

const REMINDER_INTERVAL_MS = 5 * 60 * 1000;

/** Start the recurring reminder sweep. Runs once at boot, then every 5 minutes. */
export function startEventReminderScheduler(): void {
  const run = () =>
    sendEventReminders().catch((err) =>
      logger.error({ err }, "event reminder sweep failed"),
    );
  void run();
  const timer = setInterval(run, REMINDER_INTERVAL_MS);
  timer.unref();
}
