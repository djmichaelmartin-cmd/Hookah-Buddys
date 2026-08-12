import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  eventsTable,
  eventRsvpsTable,
  eventSavesTable,
  type Event,
} from "@workspace/db";
import { CreateAdminEventBody, UpdateAdminEventBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { annotateEvents } from "./events";

const router: IRouter = Router();

function parseDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

router.get("/admin/events", requireAuth("admin"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(eventsTable).orderBy(desc(eventsTable.startsAt));
  res.json(await annotateEvents(rows, null));
});

router.post("/admin/events", requireAuth("admin"), async (req, res): Promise<void> => {
  const parsed = CreateAdminEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  const startsAt = parseDate(b.startsAt);
  if (!startsAt) {
    res.status(400).json({ error: "startsAt must be a valid date" });
    return;
  }
  const endsAt = parseDate(b.endsAt ?? null);
  if (endsAt === undefined) {
    res.status(400).json({ error: "endsAt must be a valid date" });
    return;
  }
  const [created] = await db
    .insert(eventsTable)
    .values({
      title: b.title.trim(),
      description: b.description?.trim() || null,
      loungeId: b.loungeId ?? null,
      venueName: b.venueName?.trim() || null,
      city: b.city.trim(),
      state: b.state.trim().toUpperCase(),
      startsAt,
      endsAt,
      imageUrl: b.imageUrl?.trim() || null,
      createdByUserId: req.currentUser!.id,
    })
    .returning();
  const [response] = await annotateEvents([created as Event], null);
  res.status(201).json(response);
});

router.patch("/admin/events/:id", requireAuth("admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const parsed = UpdateAdminEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  const updates: Partial<Event> = {};
  if (b.title !== undefined) updates.title = b.title.trim();
  if (b.description !== undefined) updates.description = b.description?.trim() || null;
  if (b.loungeId !== undefined) updates.loungeId = b.loungeId ?? null;
  if (b.venueName !== undefined) updates.venueName = b.venueName?.trim() || null;
  if (b.city !== undefined) updates.city = b.city.trim();
  if (b.state !== undefined) updates.state = b.state.trim().toUpperCase();
  if (b.startsAt !== undefined) {
    const d = parseDate(b.startsAt);
    if (!d) {
      res.status(400).json({ error: "startsAt must be a valid date" });
      return;
    }
    updates.startsAt = d;
  }
  if (b.endsAt !== undefined) {
    const d = parseDate(b.endsAt);
    if (d === undefined) {
      res.status(400).json({ error: "endsAt must be a valid date" });
      return;
    }
    updates.endsAt = d;
  }
  if (b.imageUrl !== undefined) updates.imageUrl = b.imageUrl?.trim() || null;
  if (b.status !== undefined) updates.status = b.status;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [updated] = await db
    .update(eventsTable)
    .set(updates)
    .where(eq(eventsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const [response] = await annotateEvents([updated as Event], null);
  res.json(response);
});

router.delete("/admin/events/:id", requireAuth("admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [deleted] = await db.delete(eventsTable).where(eq(eventsTable.id, id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  await db.delete(eventRsvpsTable).where(eq(eventRsvpsTable.eventId, id));
  await db.delete(eventSavesTable).where(eq(eventSavesTable.eventId, id));
  res.status(204).end();
});

export default router;
