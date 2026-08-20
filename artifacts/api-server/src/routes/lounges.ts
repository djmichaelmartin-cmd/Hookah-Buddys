import { Router, type IRouter } from "express";
import { and, eq, ilike, or } from "drizzle-orm";
import { db, loungesTable } from "@workspace/db";
import { ListLoungesQueryParams } from "@workspace/api-zod";
import { getSessionUser } from "../lib/auth";
import { getLocalSpotlight, saveMemberLocation } from "../lib/loungeSpotlight";

const router: IRouter = Router();

// Session-aware Local Lounge Spotlight. Location is derived ENTIRELY from the
// session (private saved location or the user's city/state) — no lat/lng/city
// override query params are accepted from the browser. The response and its
// cards never contain coordinates, the coarse location key, or user coords.
router.get("/lounge-spotlight/local", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  const result = await getLocalSpotlight(
    user ? { id: user.id, city: user.city, state: user.state } : null,
  );
  res.json(result);
});

// Save the authenticated member's SERVER-PRIVATE device location. Location comes
// ONLY from the JSON request body — never query params — so it is never part of
// any cache key or URL. The response NEVER echoes coordinates or timezone; it
// returns only { saved: true }. No coordinate/tz values are logged.
router.put("/lounge-spotlight/location", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = await saveMemberLocation(user.id, {
    latitude: body.latitude,
    longitude: body.longitude,
    timezone: body.timezone,
  });

  if (!result.ok) {
    const message =
      result.error === "invalid_timezone"
        ? "timezone must be a valid IANA time zone"
        : "latitude and longitude must be finite numbers in valid ranges";
    res.status(400).json({ error: message });
    return;
  }

  res.json({ saved: true });
});

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Public: search hookah lounges across the US by text, state, and/or proximity.
router.get("/lounges", async (req, res): Promise<void> => {
  const parsed = ListLoungesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { q, state, lat, lng, radius, limit } = parsed.data;

  if (lat !== undefined && (lat < -90 || lat > 90)) {
    res.status(400).json({ error: "lat must be between -90 and 90" });
    return;
  }
  if (lng !== undefined && (lng < -180 || lng > 180)) {
    res.status(400).json({ error: "lng must be between -180 and 180" });
    return;
  }
  const safeRadius =
    radius !== undefined ? Math.min(Math.max(radius, 0), 3000) : undefined;
  const safeLimit =
    limit !== undefined ? Math.min(Math.max(Math.trunc(limit), 1), 200) : undefined;

  const conditions = [];
  if (state) conditions.push(eq(loungesTable.state, state.toUpperCase()));
  if (q) {
    const like = `%${q}%`;
    conditions.push(
      or(
        ilike(loungesTable.name, like),
        ilike(loungesTable.city, like),
        ilike(loungesTable.description, like),
      ),
    );
  }

  const rows = await db
    .select()
    .from(loungesTable)
    .where(conditions.length ? and(...conditions) : undefined);

  const hasOrigin = typeof lat === "number" && typeof lng === "number";

  let result = rows.map((l) => {
    const base = {
      id: l.id,
      name: l.name,
      address: l.address ?? "",
      city: l.city,
      state: l.state,
      zip: l.zip ?? "",
      lat: l.lat,
      lng: l.lng,
      phone: l.phone ?? "",
      website: l.website ?? "",
      description: l.description ?? "",
      rating: l.rating ?? 0,
      priceLevel: l.priceLevel ?? 0,
      hours: l.hours ?? "",
      imageUrl: l.imageUrl ?? "",
    };
    return hasOrigin
      ? { ...base, distanceMiles: haversineMiles(lat, lng, l.lat, l.lng) }
      : base;
  });

  if (hasOrigin) {
    if (typeof safeRadius === "number") {
      result = result.filter(
        (l) => (l as { distanceMiles: number }).distanceMiles <= safeRadius,
      );
    }
    result.sort(
      (a, b) =>
        (a as { distanceMiles: number }).distanceMiles -
        (b as { distanceMiles: number }).distanceMiles,
    );
  } else {
    result.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (typeof safeLimit === "number") {
    result = result.slice(0, safeLimit);
  }

  res.json(result);
});

export default router;
