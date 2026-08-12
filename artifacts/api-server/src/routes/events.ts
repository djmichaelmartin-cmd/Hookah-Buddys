import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gt, inArray, lte } from "drizzle-orm";
import {
  db,
  eventsTable,
  eventRsvpsTable,
  eventSavesTable,
  type Event,
} from "@workspace/db";
import { getSessionUser, requireAuth } from "../lib/auth";

const router: IRouter = Router();

function eventToResponse(
  event: Event,
  rsvpCount: number,
  rsvped: boolean,
  saved: boolean,
) {
  return {
    id: event.id,
    title: event.title,
    description: event.description ?? null,
    loungeId: event.loungeId ?? null,
    venueName: event.venueName ?? null,
    city: event.city,
    state: event.state,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt ? event.endsAt.toISOString() : null,
    imageUrl: event.imageUrl ?? null,
    status: event.status === "cancelled" ? ("cancelled" as const) : ("active" as const),
    rsvpCount,
    rsvped,
    saved,
  };
}

async function annotateEvents(events: Event[], viewerUserId: number | null) {
  const ids = events.map((e) => e.id);
  if (ids.length === 0) return [];
  const counts = await db
    .select({ eventId: eventRsvpsTable.eventId, n: count() })
    .from(eventRsvpsTable)
    .where(inArray(eventRsvpsTable.eventId, ids))
    .groupBy(eventRsvpsTable.eventId);
  const countMap = new Map(counts.map((c) => [c.eventId, Number(c.n)]));

  const rsvpedSet = new Set<number>();
  const savedSet = new Set<number>();
  if (viewerUserId !== null) {
    const [rsvps, saves] = await Promise.all([
      db
        .select({ eventId: eventRsvpsTable.eventId })
        .from(eventRsvpsTable)
        .where(
          and(
            inArray(eventRsvpsTable.eventId, ids),
            eq(eventRsvpsTable.userId, viewerUserId),
          ),
        ),
      db
        .select({ eventId: eventSavesTable.eventId })
        .from(eventSavesTable)
        .where(
          and(
            inArray(eventSavesTable.eventId, ids),
            eq(eventSavesTable.userId, viewerUserId),
          ),
        ),
    ]);
    for (const r of rsvps) rsvpedSet.add(r.eventId);
    for (const s of saves) savedSet.add(s.eventId);
  }

  return events.map((e) =>
    eventToResponse(e, countMap.get(e.id) ?? 0, rsvpedSet.has(e.id), savedSet.has(e.id)),
  );
}

// Public: upcoming active events, soonest first.
// With scope=past: past active events, newest first.
// With filter=going|saved (auth required): the viewer's RSVP'd/saved active
// events (including past ones), soonest first.
// Supports limit (max 50) and offset for paging.
router.get("/events", async (req, res): Promise<void> => {
  const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : 10;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
    : 10;

  const rawOffset = req.query.offset !== undefined ? Number(req.query.offset) : 0;
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;

  const filter = req.query.filter;
  const viewer = await getSessionUser(req);

  if (filter === "going" || filter === "saved") {
    if (!viewer) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const table = filter === "going" ? eventRsvpsTable : eventSavesTable;
    const rows = await db
      .select({ event: eventsTable })
      .from(table)
      .innerJoin(eventsTable, eq(table.eventId, eventsTable.id))
      .where(and(eq(table.userId, viewer.id), eq(eventsTable.status, "active")))
      .orderBy(asc(eventsTable.startsAt))
      .limit(limit)
      .offset(offset);
    res.json(await annotateEvents(rows.map((r) => r.event), viewer.id));
    return;
  }

  const past = req.query.scope === "past";
  const now = new Date();
  const rows = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.status, "active"),
        past ? lte(eventsTable.startsAt, now) : gt(eventsTable.startsAt, now),
      ),
    )
    .orderBy(past ? desc(eventsTable.startsAt) : asc(eventsTable.startsAt))
    .limit(limit)
    .offset(offset);

  res.json(await annotateEvents(rows, viewer?.id ?? null));
});

async function loadActiveEvent(id: number): Promise<Event | null> {
  if (!Number.isInteger(id)) return null;
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!event || event.status !== "active") return null;
  return event;
}

// Public: event detail by id. Cancelled events are included (with status
// "cancelled") so reminder/cancellation notification links resolve.
router.get("/events/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const viewer = await getSessionUser(req);
  const [annotated] = await annotateEvents([event], viewer?.id ?? null);
  res.json(annotated);
});

router.post("/events/:id/rsvp", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseInt(req.params.id as string, 10);
  const event = await loadActiveEvent(id);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(eventRsvpsTable)
    .where(and(eq(eventRsvpsTable.eventId, id), eq(eventRsvpsTable.userId, user.id)));
  let rsvped: boolean;
  if (existing) {
    await db.delete(eventRsvpsTable).where(eq(eventRsvpsTable.id, existing.id));
    rsvped = false;
  } else {
    await db
      .insert(eventRsvpsTable)
      .values({ eventId: id, userId: user.id })
      .onConflictDoNothing();
    rsvped = true;
  }
  const [{ n }] = await db
    .select({ n: count() })
    .from(eventRsvpsTable)
    .where(eq(eventRsvpsTable.eventId, id));
  res.json({ rsvped, rsvpCount: Number(n) });
});

router.post("/events/:id/save", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseInt(req.params.id as string, 10);
  const event = await loadActiveEvent(id);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(eventSavesTable)
    .where(and(eq(eventSavesTable.eventId, id), eq(eventSavesTable.userId, user.id)));
  let saved: boolean;
  if (existing) {
    await db.delete(eventSavesTable).where(eq(eventSavesTable.id, existing.id));
    saved = false;
  } else {
    await db
      .insert(eventSavesTable)
      .values({ eventId: id, userId: user.id })
      .onConflictDoNothing();
    saved = true;
  }
  res.json({ saved });
});

export { annotateEvents };
export default router;
