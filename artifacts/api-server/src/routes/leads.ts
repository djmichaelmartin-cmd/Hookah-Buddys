import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { db, businessLeadsTable, rejectedLeadsTable } from "@workspace/db";
import {
  ListBusinessLeadsQueryParams,
  ListRejectedLeadsQueryParams,
  StartCollectBody,
} from "@workspace/api-zod";
import {
  collectMarket,
  type CollectProgress,
} from "@workspace/lead-collector";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// In-memory status of the most recent collection run (one process, one run at a time).
let collectStatus: CollectProgress | null = null;

function clampLimit(v: number | undefined, def: number, max: number): number {
  if (v === undefined) return def;
  return Math.min(Math.max(Math.trunc(v), 1), max);
}

function clampOffset(v: number | undefined): number {
  if (v === undefined) return 0;
  return Math.max(Math.trunc(v), 0);
}

type LeadFilters = {
  state?: string;
  city?: string;
  category?: string;
  status?: string;
  minConfidence?: number;
  q?: string;
};

function buildLeadConditions(f: LeadFilters) {
  const conditions = [];
  if (f.state) conditions.push(eq(businessLeadsTable.state, f.state.toUpperCase()));
  if (f.city) conditions.push(ilike(businessLeadsTable.city, f.city));
  if (f.category) conditions.push(eq(businessLeadsTable.category, f.category));
  if (f.status) conditions.push(eq(businessLeadsTable.validationStatus, f.status));
  if (typeof f.minConfidence === "number")
    conditions.push(gte(businessLeadsTable.confidence, Math.trunc(f.minConfidence)));
  if (f.q) {
    const like = `%${f.q}%`;
    conditions.push(
      or(
        ilike(businessLeadsTable.name, like),
        ilike(businessLeadsTable.address, like),
        ilike(businessLeadsTable.city, like),
      ),
    );
  }
  return conditions.length ? and(...conditions) : undefined;
}

function serializeLead(l: typeof businessLeadsTable.$inferSelect) {
  return {
    id: l.id,
    placeId: l.placeId,
    name: l.name,
    category: l.category,
    primaryType: l.primaryType ?? "",
    address: l.address ?? "",
    city: l.city ?? "",
    state: l.state ?? "",
    zip: l.zip ?? "",
    county: l.county ?? "",
    phone: l.phone ?? "",
    website: l.website ?? "",
    googleMapsUrl: l.googleMapsUrl ?? "",
    lat: l.lat ?? 0,
    lng: l.lng ?? 0,
    businessStatus: l.businessStatus ?? "",
    rating: l.rating ?? 0,
    reviewCount: l.reviewCount ?? 0,
    priceLevel: l.priceLevel ?? 0,
    hours: l.hours ?? "",
    instagram: l.instagram ?? "",
    facebook: l.facebook ?? "",
    sourceQuery: l.sourceQuery ?? "",
    confidence: l.confidence,
    validationStatus: l.validationStatus as
      | "confirmed"
      | "likely"
      | "needs_manual"
      | "closed",
    dateCollected: l.dateCollected ? l.dateCollected.toISOString() : undefined,
    lastVerified: l.lastVerified ? l.lastVerified.toISOString() : undefined,
  };
}

router.get("/admin/leads", requireAuth("admin"), async (req, res): Promise<void> => {
  const parsed = ListBusinessLeadsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { limit, offset, ...filters } = parsed.data;
  const where = buildLeadConditions(filters);
  const safeLimit = clampLimit(limit, 50, 500);
  const safeOffset = clampOffset(offset);

  const [{ c: total }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(businessLeadsTable)
    .where(where);

  const rows = await db
    .select()
    .from(businessLeadsTable)
    .where(where)
    .orderBy(desc(businessLeadsTable.confidence), businessLeadsTable.name)
    .limit(safeLimit)
    .offset(safeOffset);

  res.json({ total: total ?? 0, leads: rows.map(serializeLead) });
});

router.get(
  "/admin/leads/summary",
  requireAuth("admin"),
  async (_req, res): Promise<void> => {
    const [{ c: total }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(businessLeadsTable);
    const [{ c: rejectedTotal }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(rejectedLeadsTable);
    const [lastRow] = await db
      .select({ d: sql<Date>`max(${businessLeadsTable.dateCollected})` })
      .from(businessLeadsTable);

    const byState = await db
      .select({
        label: sql<string>`coalesce(${businessLeadsTable.state}, 'Unknown')`,
        count: sql<number>`count(*)::int`,
      })
      .from(businessLeadsTable)
      .groupBy(businessLeadsTable.state)
      .orderBy(sql`count(*) desc`);

    const byCity = await db
      .select({
        label: sql<string>`coalesce(${businessLeadsTable.city}, 'Unknown')`,
        count: sql<number>`count(*)::int`,
      })
      .from(businessLeadsTable)
      .groupBy(businessLeadsTable.city)
      .orderBy(sql`count(*) desc`)
      .limit(25);

    const byCategory = await db
      .select({
        label: businessLeadsTable.category,
        count: sql<number>`count(*)::int`,
      })
      .from(businessLeadsTable)
      .groupBy(businessLeadsTable.category)
      .orderBy(sql`count(*) desc`);

    const byStatus = await db
      .select({
        label: businessLeadsTable.validationStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(businessLeadsTable)
      .groupBy(businessLeadsTable.validationStatus)
      .orderBy(sql`count(*) desc`);

    res.json({
      total: total ?? 0,
      rejectedTotal: rejectedTotal ?? 0,
      lastCollectedAt: lastRow?.d ? new Date(lastRow.d).toISOString() : undefined,
      byState,
      byCity,
      byCategory,
      byStatus,
    });
  },
);

router.get(
  "/admin/leads/rejected",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const parsed = ListRejectedLeadsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const safeLimit = clampLimit(parsed.data.limit, 100, 500);
    const safeOffset = clampOffset(parsed.data.offset);

    const [{ c: total }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(rejectedLeadsTable);

    const rows = await db
      .select()
      .from(rejectedLeadsTable)
      .orderBy(desc(rejectedLeadsTable.createdAt))
      .limit(safeLimit)
      .offset(safeOffset);

    res.json({
      total: total ?? 0,
      rejected: rows.map((r) => ({
        id: r.id,
        placeId: r.placeId ?? "",
        name: r.name ?? "",
        address: r.address ?? "",
        city: r.city ?? "",
        state: r.state ?? "",
        phone: r.phone ?? "",
        reason: r.reason,
        matchedLeadId: r.matchedLeadId ?? undefined,
        sourceQuery: r.sourceQuery ?? "",
        createdAt: r.createdAt ? r.createdAt.toISOString() : undefined,
      })),
    });
  },
);

router.get(
  "/admin/leads/collect",
  requireAuth("admin"),
  async (_req, res): Promise<void> => {
    res.json(collectStatus ?? { running: false });
  },
);

router.post(
  "/admin/leads/collect",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const parsed = StartCollectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (collectStatus?.running) {
      res.status(409).json({ error: "A collection run is already in progress" });
      return;
    }

    const market = parsed.data.market;
    // Kick off in the background; the client polls GET /admin/leads/collect.
    collectStatus = {
      market,
      running: true,
      totalQueries: 0,
      queriesRun: 0,
      fetched: 0,
      inserted: 0,
      updated: 0,
      rejected: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };
    void collectMarket({
      marketId: market,
      onProgress: (p) => {
        collectStatus = p;
      },
    }).catch((err) => {
      req.log.error({ err }, "lead collection failed");
      if (collectStatus) {
        collectStatus.running = false;
        collectStatus.finishedAt = new Date().toISOString();
        collectStatus.error = err instanceof Error ? err.message : String(err);
      }
    });

    res.status(202).json(collectStatus);
  },
);

const CSV_HEADERS = [
  "placeId",
  "name",
  "category",
  "address",
  "city",
  "state",
  "zip",
  "county",
  "phone",
  "website",
  "googleMapsUrl",
  "lat",
  "lng",
  "businessStatus",
  "rating",
  "reviewCount",
  "priceLevel",
  "hours",
  "instagram",
  "facebook",
  "sourceQuery",
  "confidence",
  "validationStatus",
  "dateCollected",
  "lastVerified",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Neutralize CSV formula injection: cells beginning with =, +, -, @, or a
  // leading tab/CR can be executed as formulas by Excel/Sheets. The data comes
  // from external Google Places results, so prefix such cells with an apostrophe.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// CSV export (not part of the JSON contract). Supports the same filters as the list
// endpoint plus a `market` shortcut: ?market=las-vegas restricts to NV.
router.get(
  "/admin/leads/export.csv",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const q = req.query as Record<string, string | undefined>;
    const filters: LeadFilters = {
      state: q.state,
      city: q.city,
      category: q.category,
      status: q.status,
      minConfidence: q.minConfidence ? Number(q.minConfidence) : undefined,
      q: q.q,
    };
    let name = "hookah-leads-all";
    if (q.market === "las-vegas") {
      filters.state = "NV";
      name = "hookah-leads-las-vegas";
    } else if (q.market === "nationwide") {
      name = "hookah-leads-nationwide-master";
    }

    const where = buildLeadConditions(filters);
    const rows = await db
      .select()
      .from(businessLeadsTable)
      .where(where)
      .orderBy(businessLeadsTable.state, businessLeadsTable.city, businessLeadsTable.name);

    const lines = [CSV_HEADERS.join(",")];
    for (const l of rows) {
      const serialized = serializeLead(l);
      lines.push(
        CSV_HEADERS.map((h) => csvCell(serialized[h as keyof typeof serialized])).join(","),
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(lines.join("\n"));
  },
);

export default router;
