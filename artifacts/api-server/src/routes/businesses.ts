/**
 * Business Pages routes — /businesses and /admin/businesses
 *
 * Role capability matrix (least-privilege):
 *   owner        – everything; cannot be removed
 *   admin        – settings, team, content, inbox, insights, dashboard, notifications
 *   editor       – create/edit/delete posts, services, products, offers
 *   moderator    – hide/unhide posts, hide reviews (cannot restore admin-removed content)
 *   advertiser   – manage offers only
 *   analyst      – read-only dashboard + insights + notifications
 *   support_agent– list conversations + read/send messages
 *   (platform admin via user.role="admin") – full bypass
 *
 * Public visibility rules:
 *   - Only status="active" AND isPublished=true pages are visible to public/unauthenticated.
 *   - Team members (any role) may read their own business regardless of publish state,
 *     but suspended/closed pages block ALL writes (team and public) except admin platform.
 *   - ownerUserId is NEVER exposed to public serializers.
 *   - reply.ownerUserId is NEVER exposed; replies show the business name only.
 */
import { Readable } from "stream";
import express, { Router, type IRouter } from "express";
import { and, eq, or, ilike, sql, desc, asc, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  businessesTable,
  businessPageRolesTable,
  businessFollowsTable,
  businessSavesTable,
  businessCheckInsTable,
  businessPostsTable,
  businessPostLikesTable,
  businessReviewsTable,
  businessReviewRepliesTable,
  businessServicesTable,
  businessProductsTable,
  businessOffersTable,
  businessAppointmentsTable,
  businessConversationsTable,
  businessMessagesTable,
  businessNotificationsTable,
  businessInsightEventsTable,
  businessModerationLogsTable,
  businessAlbumsTable,
  businessMediaItemsTable,
  businessEventsTable,
  businessEventRsvpsTable,
  businessPostCommentsTable,
  businessPostSavesTable,
  businessPostReportsTable,
  businessVerificationSubmissionsTable,
  businessEngagementsTable,
  businessChildCommentsTable,
  businessContentReportsTable,
  businessMentionsTable,
  feedPostsTable,
  friendshipsTable,
  profileDetailsTable,
} from "@workspace/db";
import { requireAuth, getSessionUser } from "../lib/auth";
import {
  weightedRating as spotlightWeightedRating,
  isValidLat as spotlightIsValidLat,
  isValidLng as spotlightIsValidLng,
  invalidateDailyCachesForBusiness,
} from "../lib/loungeSpotlight";
import {
  finalizeUploadedImage,
  finalizeMediaUrlWithVideoTranscode,
  toObjectEntityPath,
  uploadVerificationDocumentBuffer,
  assertPrivateVerificationDocument,
  MAX_DOCUMENT_SIZE_BYTES,
  InvalidUploadError,
} from "../lib/imageUploads";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import { createBusinessMentions } from "../lib/businessMentions";
import {
  processBusinessSpotlightLocation,
  queueBusinessSpotlightLocation,
} from "../lib/privateGeocoding";
import {
  ALL_ASSIGNABLE_BUSINESS_ROLES,
  getBufferedAppointmentInterval,
  hasBusinessCapability,
  isAnyBusinessTeamRole,
  isBusinessPubliclyVisible,
  isBusinessWriteBlocked,
  isValidAssignableBusinessRole,
  parseAppointmentDuration,
  resolveAppointmentDuration,
  selectPublicOwnerIdentity,
  type AssignableBusinessRole,
  type BusinessTeamRole,
} from "../lib/businessPolicies";

const router: IRouter = Router();

function processQueuedBusinessLocation(
  business: typeof businessesTable.$inferSelect,
  fingerprint: string,
): void {
  void processBusinessSpotlightLocation(business, fingerprint).catch(() => {
    logger.warn(
      { businessId: business.id },
      "Business Spotlight location processing could not complete",
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Role capability helpers
// ─────────────────────────────────────────────────────────────────────────────

/** All recognized team roles. */
const ALL_ASSIGNABLE_ROLES = ALL_ASSIGNABLE_BUSINESS_ROLES;
type AssignableRole = AssignableBusinessRole;
type TeamRole = BusinessTeamRole;

function isValidAssignableRole(r: unknown): r is AssignableRole {
  return isValidAssignableBusinessRole(r);
}

/** Can read private management views (dashboard, insights, notifications). */
function canReadManagement(role: TeamRole | null): boolean {
  return hasBusinessCapability(role, "management");
}

/** Can manage business settings and team. */
function canManageSettings(role: TeamRole | null): boolean {
  return hasBusinessCapability(role, "settings");
}

/** Can publish/unpublish. Owner-only plus platform admin. */
function canPublish(role: TeamRole | null): boolean {
  return hasBusinessCapability(role, "publish");
}

/** Can create/edit/delete posts, services, products. */
function canEditContent(role: TeamRole | null): boolean {
  return hasBusinessCapability(role, "content");
}

/** Can manage offers specifically. */
function canManageOffers(role: TeamRole | null): boolean {
  return hasBusinessCapability(role, "offers");
}

/** Can reply to reviews and hide/unhide reviews (moderator action). */
function canModerateContent(role: TeamRole | null): boolean {
  return hasBusinessCapability(role, "moderation");
}

/** Can read and send messages in business inbox. */
function canAccessInbox(role: TeamRole | null): boolean {
  return hasBusinessCapability(role, "inbox");
}

/** Returns true for any recognized team role (including read-only). */
function isAnyTeamRole(role: TeamRole | null): boolean {
  return isAnyBusinessTeamRole(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle guards
// ─────────────────────────────────────────────────────────────────────────────

/** Statuses where writes (other than admin platform actions) are blocked. */
function isWriteBlocked(biz: { status: string }, isAdmin: boolean): boolean {
  return isBusinessWriteBlocked(biz, isAdmin);
}

/**
 * Determines whether a viewer may read a business's child collections.
 * - Public (any active+published page): allowed.
 * - Team members (any role) OR platform admin: allowed regardless of publish state,
 *   so owners/managers can manage draft/unpublished/suspended child data.
 * Returns { allowed, isManagementView } where isManagementView means the caller
 * is team/admin and should see unpublished/management data.
 */
async function resolveChildReadAccess(
  biz: { id: number; isPublished: boolean; status: string },
  viewer: { id: number; role?: string | null } | null,
): Promise<{ allowed: boolean; isManagementView: boolean }> {
  const viewerRole = viewer ? await getTeamRole(biz.id, viewer.id) : null;
  const isAdmin = viewer?.role === "admin";
  const isManagementView = isAnyTeamRole(viewerRole) || isAdmin;
  if (isManagementView) return { allowed: true, isManagementView: true };
  const publicVisible = isBusinessPubliclyVisible(biz);
  return { allowed: publicVisible, isManagementView: false };
}

/** Per-entity viewer engagement flags for list serializers. */
interface ChildViewerState {
  liked: boolean;
  saved: boolean;
}

/**
 * Batch-loads the authenticated viewer's like/save state across a set of child
 * entities of one type in a single query (no N+1). Returns a map keyed by
 * entityId. When there is no viewer or no ids, returns an empty map.
 */
async function loadChildViewerStates(
  viewerId: number | null | undefined,
  entityType: string,
  entityIds: number[],
): Promise<Map<number, ChildViewerState>> {
  const map = new Map<number, ChildViewerState>();
  if (!viewerId || entityIds.length === 0) return map;
  const rows = await db
    .select({ entityId: businessEngagementsTable.entityId, kind: businessEngagementsTable.kind })
    .from(businessEngagementsTable)
    .where(
      and(
        eq(businessEngagementsTable.userId, viewerId),
        eq(businessEngagementsTable.entityType, entityType),
        inArray(businessEngagementsTable.kind, ["like", "save"]),
        inArray(businessEngagementsTable.entityId, entityIds),
      ),
    );
  for (const r of rows) {
    const cur = map.get(r.entityId) ?? { liked: false, saved: false };
    if (r.kind === "like") cur.liked = true;
    else if (r.kind === "save") cur.saved = true;
    map.set(r.entityId, cur);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown by validators to signal a 400 with a client-safe message. */
class ValidationError extends Error {}

/**
 * Validates a public http(s) URL (external link). Returns the trimmed URL.
 * Rejects non-http(s) schemes (javascript:, data:, ftp:, etc.). Empty→null.
 */
function validateHttpUrl(raw: unknown, label: string): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") throw new ValidationError(`${label} must be a string URL`);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError(`${label} must be an http(s) URL`);
  }
  return trimmed;
}

/** Recognized social platform keys and expected host substrings. */
const SOCIAL_KEYS = new Set([
  "instagram",
  "twitter",
  "x",
  "facebook",
  "tiktok",
  "youtube",
  "linkedin",
  "snapchat",
]);

/**
 * Validates a socials object: each key must be a known platform and each value
 * a valid http(s) URL. Returns a normalized object, or null when empty.
 */
function validateSocials(raw: unknown): Record<string, string> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("socials must be an object of platform→URL");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || value === undefined || value === "") continue;
    if (!SOCIAL_KEYS.has(key)) {
      throw new ValidationError(`socials contains unsupported platform "${key}"`);
    }
    const url = validateHttpUrl(value, `socials.${key}`);
    if (url) out[key] = url;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Allowed primary CTA button types. */
const CTA_TYPES = new Set(["book", "booking", "call", "shop", "menu", "directions", "website", "reserve", "contact"]);

/**
 * Validates a CTA config: { label, url, type }. Type must be recognized; url
 * must be a valid http(s) URL; label required. null clears the CTA.
 */
function validateCtaConfig(raw: unknown): { label: string; url: string; type: string } | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("ctaConfig must be an object { label, url, type }");
  }
  const obj = raw as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : "";
  const label = typeof obj.label === "string" ? obj.label.trim() : "";
  if (!CTA_TYPES.has(type)) {
    throw new ValidationError(`ctaConfig.type must be one of: ${[...CTA_TYPES].join(", ")}`);
  }
  if (!label) throw new ValidationError("ctaConfig.label is required");
  const url = validateHttpUrl(obj.url, "ctaConfig.url");
  if (!url) throw new ValidationError("ctaConfig.url is required and must be an http(s) URL");
  return { label, url, type };
}

/**
 * Finalizes a media URL that MUST be an internal storage object.
 * - image kind: sniff+finalize as image.
 * - video kind: sniff/transcode, returns { url, posterUrl }.
 * Rejects external/non-storage URLs (no pass-through).
 */
async function finalizeInternalMedia(
  rawUrl: string,
  kind: "image" | "video",
  ownerId: number,
): Promise<{ url: string; posterUrl: string | null }> {
  if (!toObjectEntityPath(rawUrl)) {
    throw new InvalidUploadError(
      "media must reference an uploaded storage object; external URLs are not allowed",
    );
  }
  if (kind === "image") {
    const url = await finalizeUploadedImage(rawUrl, ownerId);
    return { url, posterUrl: null };
  }
  return finalizeMediaUrlWithVideoTranscode(rawUrl, ownerId, "video");
}

/** True if the authenticated user has a personal profile_details record. */
async function userHasPersonalProfile(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: profileDetailsTable.id })
    .from(profileDetailsTable)
    .where(eq(profileDetailsTable.userId, userId));
  return !!row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Open-now / distance computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes whether a business is currently open using its hours + timezone.
 * Returns null when hours are unknown/unparseable. Honors isOpenNowOverride.
 */
function computeOpenNow(biz: {
  hours: Record<string, string | null> | null;
  timezone: string | null;
  isOpenNowOverride: boolean | null;
}): boolean | null {
  if (biz.isOpenNowOverride !== null && biz.isOpenNowOverride !== undefined) {
    return biz.isOpenNowOverride;
  }
  if (!biz.hours) return null;
  const tz = biz.timezone || "UTC";
  try {
    // Get current time components in the business timezone.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const weekday = parts.find((p) => p.type === "weekday")?.value.toLowerCase() ?? "";
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minStr = parts.find((p) => p.type === "minute")?.value ?? "00";
    const dayKey = weekday.slice(0, 3); // mon,tue,...
    const spec = biz.hours[dayKey];
    if (!spec) return false; // closed that day
    const nowMinutes = parseInt(hourStr, 10) * 60 + parseInt(minStr, 10);
    // spec: "HH:MM-HH:MM" (may contain multiple ranges separated by comma)
    for (const range of spec.split(",")) {
      const [open, close] = range.trim().split("-");
      const [oh, om] = open.split(":").map((v) => parseInt(v, 10));
      const [ch, cm] = close.split(":").map((v) => parseInt(v, 10));
      if ([oh, om, ch, cm].some((n) => isNaN(n))) continue;
      const openM = oh * 60 + om;
      let closeM = ch * 60 + cm;
      // Overnight ranges (e.g. 18:00-02:00) wrap past midnight.
      if (closeM <= openM) closeM += 24 * 60;
      const nm = nowMinutes < openM ? nowMinutes + 24 * 60 : nowMinutes;
      if (nm >= openM && nm < closeM) return true;
    }
    return false;
  } catch {
    return null;
  }
}

/** Haversine distance in kilometers between two lat/lng points. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Validates that a proposed appointment slot falls within configured
 * availability windows for the business (if booking availability is set) and
 * respects lead time. Returns an error message string or null when valid.
 */
function validateBookingSlot(
  biz: {
    bookingEnabled: boolean;
    bookingAvailability: Record<string, string | null> | null;
    bookingLeadTimeMinutes: number | null;
    bookingSlotIntervalMinutes?: number | null;
    bookingMaxAdvanceMinutes?: number | null;
    bookingTimezone?: string | null;
    timezone: string | null;
  },
  scheduledAt: Date,
): string | null {
  if (!biz.bookingEnabled) return "Online booking is not enabled for this business";
  // Lead time
  const lead = biz.bookingLeadTimeMinutes ?? 0;
  if (scheduledAt.getTime() < Date.now() + lead * 60 * 1000) {
    return lead > 0
      ? `Appointments must be booked at least ${lead} minutes in advance`
      : "Appointment time must be in the future";
  }
  // Maximum advance window.
  const maxAdvance = biz.bookingMaxAdvanceMinutes ?? null;
  if (maxAdvance != null && maxAdvance > 0) {
    if (scheduledAt.getTime() > Date.now() + maxAdvance * 60 * 1000) {
      return `Appointments cannot be booked more than ${maxAdvance} minutes in advance`;
    }
  }
  // Slot-interval alignment. The minute-of-day must be a multiple of the
  // configured interval (evaluated in the business timezone).
  const interval = biz.bookingSlotIntervalMinutes ?? 0;
  const bookingTz = biz.bookingTimezone || biz.timezone || "UTC";
  if (interval > 0) {
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: bookingTz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = fmt.formatToParts(scheduledAt);
      const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
      if ((hh * 60 + mm) % interval !== 0) {
        return `Appointments must start on a ${interval}-minute boundary`;
      }
    } catch {
      // ignore tz parse failure — alignment simply not enforced
    }
  }
  // Availability windows (optional). When present, slot must fall inside one.
  const avail = biz.bookingAvailability;
  if (avail) {
    const tz = biz.bookingTimezone || biz.timezone || "UTC";
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = fmt.formatToParts(scheduledAt);
      const weekday = (parts.find((p) => p.type === "weekday")?.value ?? "").toLowerCase().slice(0, 3);
      const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
      const spec = avail[weekday];
      if (!spec) return "The business is not available for booking on that day";
      const slotM = hh * 60 + mm;
      let inWindow = false;
      for (const range of spec.split(",")) {
        const [open, close] = range.trim().split("-");
        const [oh, om] = open.split(":").map((v) => parseInt(v, 10));
        const [ch, cm] = close.split(":").map((v) => parseInt(v, 10));
        if ([oh, om, ch, cm].some((n) => isNaN(n))) continue;
        if (slotM >= oh * 60 + om && slotM < ch * 60 + cm) {
          inWindow = true;
          break;
        }
      }
      if (!inWindow) return "The requested time is outside the business's available booking hours";
    } catch {
      // If timezone parsing fails, skip window validation (lead-time still enforced).
    }
  }
  return null;
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Transactionally HIDE every canonical business-attributed feed row for a
 * business by flipping active rows to status="hidden". Used on page
 * unpublish/suspend/close so the linked feed items disappear in lockstep with
 * the page lifecycle (belt-and-suspenders with the dynamic public feed gate).
 * Only active rows are touched — removed/hidden rows are left as-is.
 */
async function hideBusinessFeedRows(tx: DbTx, businessId: number): Promise<void> {
  await tx
    .update(feedPostsTable)
    .set({ status: "hidden" })
    .where(
      and(
        eq(feedPostsTable.businessId, businessId),
        eq(feedPostsTable.status, "active"),
      ),
    );
}

/**
 * Transactionally RESTORE canonical business-attributed feed rows for a
 * business when the page returns to a live lifecycle (publish/reinstate).
 *
 * Restores a hidden feed row to active ONLY when its SOURCE business content
 * is itself active AND moderation-unlocked:
 *   - source="business_post"    -> business_posts row active & !moderationLocked
 *   - source="business_checkin" -> check-in row still exists & visibility public
 * Rows whose source is missing, removed, hidden, or moderation-locked stay
 * hidden, so an admin/content-moderation hide is never accidentally undone.
 */
async function restoreBusinessFeedRows(tx: DbTx, businessId: number): Promise<void> {
  // business_post-sourced rows: gated on the source post's own state.
  await tx
    .update(feedPostsTable)
    .set({ status: "active" })
    .where(
      and(
        eq(feedPostsTable.businessId, businessId),
        eq(feedPostsTable.status, "hidden"),
        eq(feedPostsTable.source, "business_post"),
        inArray(
          feedPostsTable.sourceId,
          tx
            .select({ id: businessPostsTable.id })
            .from(businessPostsTable)
            .where(
              and(
                eq(businessPostsTable.businessId, businessId),
                eq(businessPostsTable.status, "active"),
                eq(businessPostsTable.moderationLocked, false),
              ),
            ),
        ),
      ),
    );
  // business_checkin-sourced rows: gated on the source check-in still being a
  // public share.
  await tx
    .update(feedPostsTable)
    .set({ status: "active" })
    .where(
      and(
        eq(feedPostsTable.businessId, businessId),
        eq(feedPostsTable.status, "hidden"),
        eq(feedPostsTable.source, "business_checkin"),
        inArray(
          feedPostsTable.sourceId,
          tx
            .select({ id: businessCheckInsTable.id })
            .from(businessCheckInsTable)
            .where(
              and(
                eq(businessCheckInsTable.businessId, businessId),
                eq(businessCheckInsTable.visibility, "public"),
              ),
            ),
        ),
      ),
    );
}

/**
 * Detects whether a requested appointment interval [start, start+duration)
 * overlaps any existing pending/confirmed appointment for the business,
 * expanded by the configured buffer on both sides. Runs inside the caller's
 * transaction. Excludes `excludeId` (used on reschedule). Returns true if a
 * conflict exists. Callers MUST hold the per-business advisory lock first so
 * two concurrent bookings cannot both pass this check (double-booking guard).
 */
async function hasAppointmentConflict(
  tx: DbTx,
  opts: {
    businessId: number;
    startsAt: Date;
    durationMinutes: number;
    bufferMinutes: number;
    existingDefaultDurationMinutes: number;
    excludeId?: number;
  },
): Promise<boolean> {
  const requestedInterval = getBufferedAppointmentInterval(opts);
  const reqStart = requestedInterval.startsAt;
  const reqEnd = requestedInterval.endsAt;
  // Overlap when existing.start < reqEnd AND existing.end > reqStart. Existing
  // end is scheduled_at + coalesce(duration, 0). We compare in SQL for accuracy.
  const conditions = [
    eq(businessAppointmentsTable.businessId, opts.businessId),
    inArray(businessAppointmentsTable.status, ["pending", "confirmed"]),
    sql`${businessAppointmentsTable.scheduledAt} < ${reqEnd}`,
    sql`(${businessAppointmentsTable.scheduledAt} + make_interval(mins => CASE WHEN ${businessAppointmentsTable.durationMinutes} IS NULL OR ${businessAppointmentsTable.durationMinutes} <= 0 THEN ${opts.existingDefaultDurationMinutes} ELSE ${businessAppointmentsTable.durationMinutes} END)) > ${reqStart}`,
  ];
  if (opts.excludeId != null) {
    conditions.push(sql`${businessAppointmentsTable.id} <> ${opts.excludeId}`);
  }
  const rows = await tx
    .select({ id: businessAppointmentsTable.id })
    .from(businessAppointmentsTable)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

function parseHandle(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// Reserved/impersonation terms and system routes that may never be handles.
const RESERVED_HANDLES = new Set<string>([
  "hookahbuddys",
  "hookahbuddy",
  "system",
  "admin",
  "administrator",
  "support",
  "official",
  "staff",
  "moderator",
  "api",
  "www",
  "root",
  "help",
  "about",
  "settings",
  "business",
  "businesses",
  "null",
  "undefined",
]);

// Server-side prohibited substrings (impersonation + abuse). A handle
// containing any of these (after normalization) is rejected.
const PROHIBITED_HANDLE_WORDS = [
  "hookahbuddy",
  "hookahbuddys",
  "hookah_buddy",
  "hookah_buddys",
  "admin",
  "system",
  "official",
  "fuck",
  "shit",
  "bitch",
  "nigger",
  "cunt",
  "faggot",
];

/**
 * Normalizes and validates a business handle.
 * - lowercases + trims
 * - allows only letters, numbers, underscores, periods (NO hyphens)
 * - rejects reserved/impersonation terms and a prohibited-word list
 * Returns the normalized handle, or throws ValidationError.
 */
function normalizeAndValidateHandle(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ValidationError("handle is required");
  }
  const handle = raw.trim().toLowerCase();
  if (handle.length < 2 || handle.length > 30) {
    throw new ValidationError("handle must be between 2 and 30 characters");
  }
  if (!/^[a-z0-9_.]+$/.test(handle)) {
    throw new ValidationError(
      "handle may only contain lowercase letters, numbers, underscores, and periods",
    );
  }
  if (RESERVED_HANDLES.has(handle)) {
    throw new ValidationError("This handle is reserved and cannot be used");
  }
  const collapsed = handle.replace(/[._]/g, "");
  for (const word of PROHIBITED_HANDLE_WORDS) {
    const collapsedWord = word.replace(/[._]/g, "");
    if (handle.includes(word) || collapsed.includes(collapsedWord)) {
      throw new ValidationError("This handle contains a prohibited or restricted term");
    }
  }
  return handle;
}

async function getBusinessByHandle(handle: string) {
  const [biz] = await db
    .select()
    .from(businessesTable)
    .where(eq(businessesTable.handle, handle.toLowerCase()));
  return biz ?? null;
}

async function getTeamRole(businessId: number, userId: number): Promise<TeamRole | null> {
  const [row] = await db
    .select({ role: businessPageRolesTable.role })
    .from(businessPageRolesTable)
    .where(
      and(
        eq(businessPageRolesTable.businessId, businessId),
        eq(businessPageRolesTable.userId, userId),
      ),
    );
  return (row?.role as TeamRole) ?? null;
}

async function getUserPublic(userId: number) {
  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return user ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serializers — privacy-safe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Public-safe business summary (list view). Never includes ownerUserId.
 */
function serializeBusinessSummary(biz: typeof businessesTable.$inferSelect) {
  return {
    id: biz.id,
    handle: biz.handle,
    name: biz.name,
    businessType: biz.businessType,
    category: biz.category,
    tagline: biz.tagline ?? null,
    logoUrl: biz.logoUrl ?? null,
    coverUrl: biz.coverUrl ?? null,
    city: biz.city ?? null,
    state: biz.state ?? null,
    averageRating: biz.averageRating ?? null,
    reviewCount: biz.reviewCount,
    followerCount: biz.followerCount,
    checkInCount: biz.checkInCount,
    badges: biz.badges ?? [],
    tags: biz.tags ?? [],
    verificationStatus: biz.verificationStatus,
    isVerified: biz.verificationStatus === "verified",
    isFeatured: biz.isFeatured,
    isSponsored: biz.isSponsored,
    status: biz.status,
    isPublished: biz.isPublished,
    createdAt: biz.createdAt.toISOString(),
  };
}

/**
 * Admin business summary — the public summary augmented with Local Lounge
 * Spotlight diagnostics for the admin list. Only surfaced to platform admins.
 *   - eligibleForLoungeSpotlight: the admin-controlled suitability flag.
 *   - hasUsableSpotlightLocation: valid mappable business coordinates present.
 *   - hasUsableSpotlightRating: averageRating present AND reviewCount > 0.
 *   - spotlightWeightedRating: the exact weighted rating used for ranking.
 */
function serializeAdminBusinessSummary(biz: typeof businessesTable.$inferSelect) {
  const hasUsableSpotlightLocation =
    spotlightIsValidLat(biz.lat) && spotlightIsValidLng(biz.lng);
  const hasUsableSpotlightRating =
    biz.averageRating != null && biz.reviewCount > 0;
  return {
    ...serializeBusinessSummary(biz),
    eligibleForLoungeSpotlight: biz.eligibleForLoungeSpotlight,
    hasUsableSpotlightLocation,
    hasUsableSpotlightRating,
    spotlightWeightedRating:
      Math.round(spotlightWeightedRating(biz.averageRating, biz.reviewCount) * 1000) /
      1000,
  };
}

/**
 * Full business detail. ownerUserId is never included.
 * Owner display (name + photo) is only shown when showOwner is true.
 */
async function serializeBusinessDetail(
  biz: typeof businessesTable.$inferSelect,
  viewerId: number | null,
) {
  // Owner display — only if the page has opted in
  let ownerCandidate: { name: string; photoUrl: string | null } | null = null;
  if (biz.showOwner) {
    const u = await getUserPublic(biz.ownerUserId);
    if (u) ownerCandidate = { name: u.name, photoUrl: u.profilePhotoUrl ?? null };
  }
  const owner = selectPublicOwnerIdentity(biz.showOwner, ownerCandidate);

  // Viewer engagement
  let viewerFollows = false;
  let viewerSaved = false;
  let viewerRole: TeamRole | null = null;
  if (viewerId != null) {
    const [follow] = await db
      .select({ id: businessFollowsTable.id })
      .from(businessFollowsTable)
      .where(
        and(
          eq(businessFollowsTable.businessId, biz.id),
          eq(businessFollowsTable.userId, viewerId),
        ),
      );
    viewerFollows = !!follow;
    const [save] = await db
      .select({ id: businessSavesTable.id })
      .from(businessSavesTable)
      .where(
        and(
          eq(businessSavesTable.businessId, biz.id),
          eq(businessSavesTable.userId, viewerId),
        ),
      );
    viewerSaved = !!save;
    viewerRole = await getTeamRole(biz.id, viewerId);
  }

  return {
    id: biz.id,
    handle: biz.handle,
    name: biz.name,
    businessType: biz.businessType,
    category: biz.category,
    tagline: biz.tagline ?? null,
    description: biz.description ?? null,
    mission: biz.mission ?? null,
    foundedDate: biz.foundedDate ?? null,
    logoUrl: biz.logoUrl ?? null,
    coverUrl: biz.coverUrl ?? null,
    address: biz.address ?? null,
    city: biz.city ?? null,
    state: biz.state ?? null,
    zip: biz.zip ?? null,
    country: biz.country,
    lat: biz.lat ?? null,
    lng: biz.lng ?? null,
    serviceArea: biz.serviceArea ?? null,
    phone: biz.phone ?? null,
    email: biz.email ?? null,
    website: biz.website ?? null,
    socials: biz.socials ?? null,
    hours: biz.hours ?? null,
    specialHours: biz.specialHours ?? null,
    parkingInfo: biz.parkingInfo ?? null,
    priceRange: biz.priceRange ?? null,
    amenities: biz.amenities ?? [],
    paymentMethods: biz.paymentMethods ?? [],
    accessibility: biz.accessibility ?? null,
    ageRequirement: biz.ageRequirement ?? null,
    timezone: biz.timezone ?? null,
    status: biz.status,
    isOpenNowOverride: biz.isOpenNowOverride ?? null,
    openNow: computeOpenNow(biz),
    isPublished: biz.isPublished,
    badges: biz.badges ?? [],
    tags: biz.tags ?? [],
    communityInterests: biz.communityInterests ?? [],
    verificationStatus: biz.verificationStatus,
    isVerified: biz.verificationStatus === "verified",
    isFeatured: biz.isFeatured,
    isSponsored: biz.isSponsored,
    bookingEnabled: biz.bookingEnabled,
    bookingAvailability: biz.bookingAvailability ?? null,
    bookingLeadTimeMinutes: biz.bookingLeadTimeMinutes ?? null,
    bookingSlotIntervalMinutes: biz.bookingSlotIntervalMinutes,
    bookingMaxAdvanceMinutes: biz.bookingMaxAdvanceMinutes ?? null,
    bookingBufferMinutes: biz.bookingBufferMinutes,
    bookingDefaultDurationMinutes: biz.bookingDefaultDurationMinutes,
    bookingTimezone: biz.bookingTimezone ?? null,
    allowMentions: biz.allowMentions,
    mentionsRequireApproval: biz.mentionsRequireApproval,
    ctaConfig: biz.ctaConfig ?? null,
    tabsEnabled: biz.tabsEnabled ?? null,
    showOwner: biz.showOwner,
    followerCount: biz.followerCount,
    saveCount: biz.saveCount,
    reviewCount: biz.reviewCount,
    checkInCount: biz.checkInCount,
    postCount: biz.postCount,
    averageRating: biz.averageRating ?? null,
    // ownerUserId intentionally omitted from all public serializers
    owner,  // null unless showOwner=true; contains only {name, photoUrl}
    viewerFollows,
    viewerSaved,
    viewerRole: viewerRole ?? null,  // viewer's own role string, null if not team
    viewerIsTeam: isAnyTeamRole(viewerRole),
    createdAt: biz.createdAt.toISOString(),
    updatedAt: biz.updatedAt.toISOString(),
  };
}

function serializeService(s: typeof businessServicesTable.$inferSelect) {
  return {
    id: s.id,
    businessId: s.businessId,
    name: s.name,
    description: s.description ?? null,
    category: s.category ?? null,
    priceLabel: s.priceLabel ?? null,
    priceCents: s.priceCents ?? null,
    salePriceCents: s.salePriceCents ?? null,
    durationMinutes: s.durationMinutes ?? null,
    imageUrl: s.imageUrl ?? null,
    bookingUrl: s.bookingUrl ?? null,
    isActive: s.isActive,
    status: s.status,
    sortOrder: s.sortOrder,
    createdAt: s.createdAt.toISOString(),
  };
}

function serializeProduct(
  p: typeof businessProductsTable.$inferSelect,
  viewerState?: ChildViewerState,
) {
  return {
    id: p.id,
    businessId: p.businessId,
    name: p.name,
    description: p.description ?? null,
    category: p.category ?? null,
    priceCents: p.priceCents ?? null,
    salePriceCents: p.salePriceCents ?? null,
    priceLabel: p.priceLabel ?? null,
    imageUrl: p.imageUrl ?? null,
    imageUrls: p.imageUrls ?? [],
    purchaseUrl: p.purchaseUrl ?? null,
    sku: p.sku ?? null,
    isAvailable: p.isAvailable,
    status: p.status,
    likeCount: p.likeCount,
    saveCount: p.saveCount,
    commentCount: p.commentCount,
    viewerLiked: viewerState?.liked ?? false,
    viewerSaved: viewerState?.saved ?? false,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt.toISOString(),
  };
}

function serializeOffer(
  o: typeof businessOffersTable.$inferSelect,
  viewerState?: ChildViewerState,
) {
  return {
    id: o.id,
    businessId: o.businessId,
    title: o.title,
    description: o.description ?? null,
    discountLabel: o.discountLabel ?? null,
    code: o.code ?? null,
    terms: o.terms ?? null,
    redeemUrl: o.redeemUrl ?? null,
    imageUrl: o.imageUrl ?? null,
    startsAt: o.startsAt?.toISOString() ?? null,
    expiresAt: o.expiresAt?.toISOString() ?? null,
    isActive: o.isActive,
    likeCount: o.likeCount,
    saveCount: o.saveCount,
    commentCount: o.commentCount,
    viewerLiked: viewerState?.liked ?? false,
    viewerSaved: viewerState?.saved ?? false,
    createdAt: o.createdAt.toISOString(),
  };
}

/**
 * Review serializer — omits ownerUserId from reply; shows business-level attribution.
 */
function serializeReview(
  r: typeof businessReviewsTable.$inferSelect,
  user: { name: string; profilePhotoUrl: string | null } | null,
  reply: typeof businessReviewRepliesTable.$inferSelect | null,
) {
  return {
    id: r.id,
    businessId: r.businessId,
    // userId exposed for reviewer (they can see their own review attributed)
    userId: r.userId,
    userName: user?.name ?? "Unknown",
    userPhotoUrl: user?.profilePhotoUrl ?? null,
    rating: r.rating,
    text: r.text ?? null,
    status: r.status,
    reply: reply
      ? {
          id: reply.id,
          reviewId: reply.reviewId,
          // ownerUserId intentionally omitted — reply attributed to business name
          text: reply.text,
          createdAt: reply.createdAt.toISOString(),
        }
      : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Side-effect helpers
// ─────────────────────────────────────────────────────────────────────────────

async function recordInsightEvent(
  businessId: number,
  eventType: string,
  userId: number | null,
) {
  try {
    await db.insert(businessInsightEventsTable).values({
      businessId,
      eventType,
      userId: userId ?? undefined,
    });
  } catch (err) {
    logger.warn({ err, businessId, eventType }, "Failed to record insight event");
  }
}

async function notifyBusinessTeam(
  businessId: number,
  type: string,
  title: string,
  message: string,
  options?: { relatedEntityId?: number; relatedEntityType?: string },
) {
  const team = await db
    .select({ userId: businessPageRolesTable.userId, role: businessPageRolesTable.role })
    .from(businessPageRolesTable)
    .where(eq(businessPageRolesTable.businessId, businessId));

  // Only notify owner and admin roles
  const recipients = team.filter((m) => m.role === "owner" || m.role === "admin");
  if (recipients.length === 0) return;

  await db.insert(businessNotificationsTable).values(
    recipients.map((m) => ({
      businessId,
      recipientUserId: m.userId,
      type,
      title,
      message,
      relatedEntityId: options?.relatedEntityId ?? null,
      relatedEntityType: options?.relatedEntityType ?? null,
    })),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public list / search
// ─────────────────────────────────────────────────────────────────────────────

router.get("/businesses", async (req, res): Promise<void> => {
  const qp = req.query as Record<string, string | undefined>;
  const q = typeof qp.q === "string" ? qp.q.trim() : undefined;
  const city = qp.city;
  const state = qp.state;
  const category = qp.category;
  const businessType = qp.businessType;
  const verified = qp.verified === "true";
  const featured = qp.featured === "true";
  const sponsored = qp.sponsored === "true";
  const openNowFilter = qp.openNow === "true";
  const hasProducts = qp.hasProducts === "true";
  const hasServices = qp.hasServices === "true";
  const hasEvents = qp.hasEvents === "true";
  const hasOffers = qp.hasOffers === "true";
  const appointmentsAvailable = qp.appointmentsAvailable === "true";
  const minRating = qp.minRating ? parseFloat(qp.minRating) : undefined;
  const lat = qp.lat ? parseFloat(qp.lat) : undefined;
  const lng = qp.lng ? parseFloat(qp.lng) : undefined;
  const radiusKm = qp.radius ? parseFloat(qp.radius) : undefined;
  const sort = [
    "recommended",
    "distance",
    "rating",
    "newest",
    "most_followed",
    "most_recommended",
    "recently_active",
  ].includes(qp.sort ?? "")
    ? (qp.sort as
        | "recommended"
        | "distance"
        | "rating"
        | "newest"
        | "most_followed"
        | "most_recommended"
        | "recently_active")
    : "recommended";
  const limit = Math.min(qp.limit ? parseInt(qp.limit, 10) || 20 : 20, 100);
  const offset = qp.offset ? parseInt(qp.offset, 10) || 0 : 0;

  const conditions = [
    eq(businessesTable.isPublished, true),
    eq(businessesTable.status, "active"),
  ];
  if (q) {
    conditions.push(
      or(
        ilike(businessesTable.name, `%${q}%`),
        ilike(businessesTable.tagline, `%${q}%`),
        ilike(businessesTable.description, `%${q}%`),
      )!,
    );
  }
  if (city) conditions.push(ilike(businessesTable.city, `%${city}%`));
  if (state) conditions.push(eq(businessesTable.state, state));
  if (category) conditions.push(eq(businessesTable.category, category));
  if (businessType) conditions.push(eq(businessesTable.businessType, businessType));
  if (verified) conditions.push(eq(businessesTable.verificationStatus, "verified"));
  // Featured/sponsored honor the *Until window: a flag with a past expiry is
  // no longer eligible.
  if (featured) {
    conditions.push(
      sql`${businessesTable.isFeatured} = true AND (${businessesTable.featuredUntil} IS NULL OR ${businessesTable.featuredUntil} > now())`,
    );
  }
  if (sponsored) {
    conditions.push(
      sql`${businessesTable.isSponsored} = true AND (${businessesTable.sponsoredUntil} IS NULL OR ${businessesTable.sponsoredUntil} > now())`,
    );
  }
  if (appointmentsAvailable) {
    conditions.push(eq(businessesTable.bookingEnabled, true));
  }
  if (minRating !== undefined && !isNaN(minRating)) {
    conditions.push(sql`${businessesTable.averageRating} >= ${minRating}`);
  }
  // hasX filters use EXISTS subqueries against the child collections.
  if (hasServices) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM business_services s WHERE s.business_id = ${businessesTable.id} AND s.is_active = true AND s.status = 'active')`,
    );
  }
  if (hasProducts) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM business_products p WHERE p.business_id = ${businessesTable.id} AND p.is_available = true AND p.status = 'active')`,
    );
  }
  if (hasOffers) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM business_offers o WHERE o.business_id = ${businessesTable.id} AND o.is_active = true AND (o.expires_at IS NULL OR o.expires_at > now()))`,
    );
  }
  if (hasEvents) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM business_events e WHERE e.business_id = ${businessesTable.id} AND e.status = 'active' AND e.visibility = 'public')`,
    );
  }

  // Effective (non-expired) promotion flags used for ranking. A flag whose
  // *Until has passed no longer boosts ranking.
  const effSponsored = sql`(${businessesTable.isSponsored} = true AND (${businessesTable.sponsoredUntil} IS NULL OR ${businessesTable.sponsoredUntil} > now()))`;
  const effFeatured = sql`(${businessesTable.isFeatured} = true AND (${businessesTable.featuredUntil} IS NULL OR ${businessesTable.featuredUntil} > now()))`;

  // Sorting. Distance sort requires lat/lng and is applied post-query (Haversine).
  let orderBy;
  if (sort === "rating") {
    orderBy = [desc(businessesTable.averageRating), desc(businessesTable.reviewCount)];
  } else if (sort === "newest") {
    orderBy = [desc(businessesTable.createdAt)];
  } else if (sort === "most_followed") {
    orderBy = [desc(businessesTable.followerCount), desc(businessesTable.createdAt)];
  } else if (sort === "recently_active") {
    orderBy = [desc(businessesTable.updatedAt), desc(businessesTable.createdAt)];
  } else {
    // recommended / most_recommended: non-expired sponsored + featured first,
    // then recommendation strength (reviews + followers), then recency.
    orderBy = [
      desc(effSponsored),
      desc(effFeatured),
      desc(businessesTable.reviewCount),
      desc(businessesTable.followerCount),
      desc(businessesTable.createdAt),
    ];
  }

  // For distance sort / radius filter we over-fetch then sort/paginate in memory.
  const geoMode = (sort === "distance" || radiusKm !== undefined) && lat !== undefined && lng !== undefined;

  let rows = await db
    .select()
    .from(businessesTable)
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(geoMode ? 500 : limit)
    .offset(geoMode ? 0 : offset);

  const hasGeo = lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng);

  let results = rows.map((biz) => {
    const openNow = computeOpenNow(biz);
    const distanceKm =
      hasGeo && biz.lat != null && biz.lng != null
        ? haversineKm(lat!, lng!, biz.lat, biz.lng)
        : null;
    return { biz, openNow, distanceKm };
  });

  if (openNowFilter) results = results.filter((r) => r.openNow === true);
  if (radiusKm !== undefined && !isNaN(radiusKm) && hasGeo) {
    results = results.filter((r) => r.distanceKm !== null && r.distanceKm <= radiusKm);
  }
  if (sort === "distance" && hasGeo) {
    results.sort((a, b) => {
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }
  if (geoMode) results = results.slice(offset, offset + limit);

  res.json(
    results.map((r) => ({
      ...serializeBusinessSummary(r.biz),
      openNow: r.openNow,
      distanceKm: r.distanceKm !== null ? Math.round(r.distanceKm * 10) / 10 : null,
    })),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Create business page
// ─────────────────────────────────────────────────────────────────────────────

router.post("/businesses", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const body = req.body as Record<string, unknown>;

  // Gate: the creator must already have a personal member profile.
  if (!(await userHasPersonalProfile(user.id))) {
    res.status(403).json({
      error: "You must complete your personal member profile before creating a business page",
    });
    return;
  }

  let handle: string;
  try {
    handle = normalizeAndValidateHandle(body.handle);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  const name = typeof body.name === "string" ? body.name.trim() : null;
  const businessType = typeof body.businessType === "string" ? body.businessType : null;
  // category is now OPTIONAL.
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!businessType) {
    res.status(400).json({ error: "businessType is required" });
    return;
  }

  const [handleTaken] = await db
    .select({ id: businessesTable.id })
    .from(businessesTable)
    .where(eq(businessesTable.handle, handle));
  if (handleTaken) {
    res.status(400).json({ error: "This handle is already taken" });
    return;
  }

  // Validate URLs server-side (website, socials, CTA).
  let website: string | null;
  let socials: Record<string, string> | null;
  let ctaConfig: { label: string; url: string; type: string } | null;
  try {
    website = validateHttpUrl(body.website, "website");
    socials = validateSocials(body.socials);
    ctaConfig = body.ctaConfig !== undefined ? validateCtaConfig(body.ctaConfig) : null;
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  // Finalize logo/cover images via storage ownership check
  let logoUrl: string | null = null;
  let coverUrl: string | null = null;
  try {
    const rawLogo = typeof body.logoUrl === "string" && body.logoUrl ? body.logoUrl : null;
    const rawCover = typeof body.coverUrl === "string" && body.coverUrl ? body.coverUrl : null;
    if (rawLogo) logoUrl = await finalizeUploadedImage(rawLogo, user.id);
    if (rawCover) coverUrl = await finalizeUploadedImage(rawCover, user.id);
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const [biz] = await db
    .insert(businessesTable)
    .values({
      ownerUserId: user.id,
      handle,
      name,
      businessType,
      category,
      tagline: typeof body.tagline === "string" ? body.tagline : null,
      description: typeof body.description === "string" ? body.description : null,
      mission: typeof body.mission === "string" ? body.mission : null,
      foundedDate: typeof body.foundedDate === "string" ? body.foundedDate : null,
      logoUrl,
      coverUrl,
      address: typeof body.address === "string" ? body.address : null,
      city: typeof body.city === "string" ? body.city : null,
      state: typeof body.state === "string" ? body.state : null,
      zip: typeof body.zip === "string" ? body.zip : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      email: typeof body.email === "string" ? body.email : null,
      website,
      socials,
      ctaConfig,
      timezone: typeof body.timezone === "string" ? body.timezone : null,
      tags: Array.isArray(body.tags) ? (body.tags as string[]) : null,
      hours: (body.hours as Record<string, string | null> | undefined) ?? null,
      status: "draft",
      isPublished: false,
    })
    .returning();

  // Register creator as owner in team roles
  await db.insert(businessPageRolesTable).values({
    businessId: biz.id,
    userId: user.id,
    role: "owner",
  });

  const locationFingerprint =
    biz.address?.trim() && biz.city?.trim() && biz.state?.trim()
      ? await queueBusinessSpotlightLocation(biz)
      : null;
  const response = await serializeBusinessDetail(biz, user.id);
  res.status(201).json(response);
  if (locationFingerprint) processQueuedBusinessLocation(biz, locationFingerprint);
});

// ─────────────────────────────────────────────────────────────────────────────
// Get by handle (public / team)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/businesses/:handle", async (req, res): Promise<void> => {
  const handle = parseHandle(req.params.handle);
  const viewer = await getSessionUser(req);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const viewerRole = viewer ? await getTeamRole(biz.id, viewer.id) : null;
  const isAdmin = viewer?.role === "admin";

  // Public can only see active+published pages
  if (!isAnyTeamRole(viewerRole) && !isAdmin) {
    if (!isBusinessPubliclyVisible(biz)) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
  }

  // Record view insight (do not await — best effort)
  void recordInsightEvent(biz.id, "profile_view", viewer?.id ?? null);

  res.json(await serializeBusinessDetail(biz, viewer?.id ?? null));
});

// ─────────────────────────────────────────────────────────────────────────────
// Update settings (owner, admin, editor for non-publish fields)
// ─────────────────────────────────────────────────────────────────────────────

router.patch("/businesses/:handle/settings", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const role = await getTeamRole(biz.id, user.id);
  const isAdmin = user.role === "admin";

  // Editors can change content fields; settings changes require admin/owner
  if (!canEditContent(role) && !isAdmin) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  // Blocked status prevents all team writes (only platform admin can act)
  if (isWriteBlocked(biz, isAdmin)) {
    res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const refreshSpotlightLocation = body.refreshSpotlightLocation === true;
  const normalizeLocationPart = (value: unknown) =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ").toUpperCase() : "";
  const locationChanged = (["address", "city", "state", "zip"] as const).some(
    (field) =>
      body[field] !== undefined &&
      normalizeLocationPart(body[field]) !== normalizeLocationPart(biz[field]),
  );
  const canManageLocation = canManageSettings(role) || isAdmin;
  if (
    (refreshSpotlightLocation && !canManageLocation) ||
    (locationChanged && !canManageLocation)
  ) {
    res.status(403).json({ error: "Insufficient permissions for location settings" });
    return;
  }

  // Finalize logo/cover images
  let logoUrl: string | null | undefined = undefined;
  let coverUrl: string | null | undefined = undefined;
  try {
    if (body.logoUrl !== undefined) {
      const raw = body.logoUrl as string | null;
      if (raw && raw !== biz.logoUrl) {
        logoUrl = await finalizeUploadedImage(raw, user.id);
      } else {
        logoUrl = raw;
      }
    }
    if (body.coverUrl !== undefined) {
      const raw = body.coverUrl as string | null;
      if (raw && raw !== biz.coverUrl) {
        coverUrl = await finalizeUploadedImage(raw, user.id);
      } else {
        coverUrl = raw;
      }
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const updates: Partial<typeof businessesTable.$inferInsert> = {};

  // Validate URL fields server-side up-front.
  try {
    if (body.website !== undefined) updates.website = validateHttpUrl(body.website, "website");
    if (body.socials !== undefined) updates.socials = validateSocials(body.socials);
    if (body.ctaConfig !== undefined) {
      // CTA is a settings-level field (owner/admin only) — applied below.
      (body as Record<string, unknown>).__validatedCta = validateCtaConfig(body.ctaConfig);
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  // Name/identity — owner/admin only
  if (canManageSettings(role) || isAdmin) {
    if (body.name !== undefined && typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (body.showOwner !== undefined) updates.showOwner = Boolean(body.showOwner);
    if (body.ctaConfig !== undefined) {
      updates.ctaConfig =
        ((body as Record<string, unknown>).__validatedCta as typeof biz.ctaConfig) ?? null;
    }
    if (body.tabsEnabled !== undefined) updates.tabsEnabled = (body.tabsEnabled as Record<string, boolean> | null) ?? null;
    if (body.timezone !== undefined) updates.timezone = typeof body.timezone === "string" ? body.timezone : null;
    if (body.tags !== undefined) updates.tags = Array.isArray(body.tags) ? (body.tags as string[]) : null;
    if (body.communityInterests !== undefined) {
      updates.communityInterests = Array.isArray(body.communityInterests)
        ? (body.communityInterests as string[])
        : null;
    }
    if (body.bookingEnabled !== undefined) updates.bookingEnabled = Boolean(body.bookingEnabled);
    if (body.bookingAvailability !== undefined) {
      updates.bookingAvailability =
        (body.bookingAvailability as Record<string, string | null> | null) ?? null;
    }
    if (body.bookingLeadTimeMinutes !== undefined) {
      updates.bookingLeadTimeMinutes =
        typeof body.bookingLeadTimeMinutes === "number" ? body.bookingLeadTimeMinutes : null;
    }
    if (body.bookingSlotIntervalMinutes !== undefined && typeof body.bookingSlotIntervalMinutes === "number") {
      updates.bookingSlotIntervalMinutes = Math.max(1, Math.floor(body.bookingSlotIntervalMinutes));
    }
    if (body.bookingMaxAdvanceMinutes !== undefined) {
      updates.bookingMaxAdvanceMinutes =
        typeof body.bookingMaxAdvanceMinutes === "number" ? body.bookingMaxAdvanceMinutes : null;
    }
    if (body.bookingBufferMinutes !== undefined && typeof body.bookingBufferMinutes === "number") {
      updates.bookingBufferMinutes = Math.max(0, Math.floor(body.bookingBufferMinutes));
    }
    if (body.bookingDefaultDurationMinutes !== undefined && typeof body.bookingDefaultDurationMinutes === "number") {
      updates.bookingDefaultDurationMinutes = Math.max(1, Math.floor(body.bookingDefaultDurationMinutes));
    }
    if (body.bookingTimezone !== undefined) {
      updates.bookingTimezone = typeof body.bookingTimezone === "string" ? body.bookingTimezone : null;
    }
    if (body.allowMentions !== undefined) updates.allowMentions = Boolean(body.allowMentions);
    if (body.mentionsRequireApproval !== undefined) {
      updates.mentionsRequireApproval = Boolean(body.mentionsRequireApproval);
    }
    for (const field of ["address", "city", "state", "zip"] as const) {
      if (body[field] !== undefined) {
        updates[field] = typeof body[field] === "string" ? body[field].trim() : null;
      }
    }
  }

  // Publish/unpublish — owner only (+ platform admin)
  if (body.isPublished !== undefined && (canPublish(role) || isAdmin)) {
    updates.isPublished = Boolean(body.isPublished);
  }

  const strFields = [
    "tagline", "description", "mission", "foundedDate", "serviceArea", "phone",
    "email", "parkingInfo", "priceRange",
    "accessibility", "ageRequirement",
  ] as const;
  for (const field of strFields) {
    if (body[field] !== undefined) {
      (updates as Record<string, unknown>)[field] = body[field] ?? null;
    }
  }
  if (logoUrl !== undefined) updates.logoUrl = logoUrl;
  if (coverUrl !== undefined) updates.coverUrl = coverUrl;
  if (body.lat !== undefined) updates.lat = typeof body.lat === "number" ? body.lat : null;
  if (body.lng !== undefined) updates.lng = typeof body.lng === "number" ? body.lng : null;
  if (body.hours !== undefined) updates.hours = (body.hours as Record<string, string | null> | null) ?? null;
  if (body.specialHours !== undefined) {
    updates.specialHours =
      (body.specialHours as Array<{ date: string; label: string; hours: string | null }> | null) ?? null;
  }
  if (body.amenities !== undefined)
    updates.amenities = Array.isArray(body.amenities) ? (body.amenities as string[]) : null;
  if (body.paymentMethods !== undefined)
    updates.paymentMethods = Array.isArray(body.paymentMethods) ? (body.paymentMethods as string[]) : null;
  if (body.isOpenNowOverride !== undefined) {
    updates.isOpenNowOverride = body.isOpenNowOverride === null ? null : Boolean(body.isOpenNowOverride);
  }

  if (Object.keys(updates).length === 0 && !refreshSpotlightLocation) {
    res.status(400).json({ error: "No updatable fields provided" });
    return;
  }

  // If the publish flag is transitioning, hide/restore linked canonical feed
  // rows in the SAME transaction as the update so the feed never lags the page
  // lifecycle. Unpublish hides; publish restores (only sources that are
  // themselves active + moderation-unlocked, and only when status="active").
  const publishTransition =
    updates.isPublished !== undefined && updates.isPublished !== biz.isPublished
      ? (updates.isPublished as boolean)
      : null;

  const updated =
    Object.keys(updates).length === 0
      ? biz
      : (
          await db.transaction(async (tx) => {
            const [row] = await tx
              .update(businessesTable)
              .set(updates)
              .where(eq(businessesTable.id, biz.id))
              .returning();
            if (publishTransition === false) {
              await hideBusinessFeedRows(tx, biz.id);
            } else if (publishTransition === true && row.status === "active") {
              await restoreBusinessFeedRows(tx, biz.id);
            }
            return [row];
          })
        )[0];

  const locationFingerprint =
    locationChanged || refreshSpotlightLocation
      ? await queueBusinessSpotlightLocation(updated, db, {
          preserveExistingCoordinates:
            refreshSpotlightLocation && !locationChanged,
        })
      : null;
  const response = await serializeBusinessDetail(updated, user.id);
  res.json(response);
  if (locationFingerprint) {
    processQueuedBusinessLocation(updated, locationFingerprint);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Follow / Unfollow (public→active+published only)
// Counter updated only when a row is actually inserted/deleted.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/businesses/:handle/follow", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz || !biz.isPublished || biz.status !== "active") {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  // Toggle + counter mutation are atomic in one transaction so the
  // denormalized followerCount can never drift from the row set even under
  // concurrent requests. The unique index (businessId,userId) makes the
  // insert conflict-safe; the counter only changes when a row truly changed.
  const { active, followerCount, didFollow } = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(businessFollowsTable)
      .where(
        and(
          eq(businessFollowsTable.businessId, biz.id),
          eq(businessFollowsTable.userId, user.id),
        ),
      )
      .returning({ id: businessFollowsTable.id });

    if (deleted.length > 0) {
      const [row] = await tx
        .update(businessesTable)
        .set({ followerCount: sql`greatest(${businessesTable.followerCount} - 1, 0)` })
        .where(eq(businessesTable.id, biz.id))
        .returning({ followerCount: businessesTable.followerCount });
      return { active: false, followerCount: row.followerCount, didFollow: false };
    }

    const inserted = await tx
      .insert(businessFollowsTable)
      .values({ businessId: biz.id, userId: user.id })
      .onConflictDoNothing()
      .returning({ id: businessFollowsTable.id });

    if (inserted.length > 0) {
      const [row] = await tx
        .update(businessesTable)
        .set({ followerCount: sql`${businessesTable.followerCount} + 1` })
        .where(eq(businessesTable.id, biz.id))
        .returning({ followerCount: businessesTable.followerCount });
      return { active: true, followerCount: row.followerCount, didFollow: true };
    }

    // Insert conflicted (already following) — no counter change
    const [row] = await tx
      .select({ followerCount: businessesTable.followerCount })
      .from(businessesTable)
      .where(eq(businessesTable.id, biz.id));
    return { active: true, followerCount: row.followerCount, didFollow: false };
  });

  if (didFollow) {
    void recordInsightEvent(biz.id, "follow", user.id);
    void notifyBusinessTeam(
      biz.id,
      "new_follower",
      "New follower",
      `${user.name} followed your business page`,
    );
  }

  res.json({ active, followerCount });
});

// ─────────────────────────────────────────────────────────────────────────────
// Follower list + count (team/admin only — followers are private management data)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/businesses/:handle/followers", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const role = await getTeamRole(biz.id, user.id);
  const isAdmin = user.role === "admin";
  if (!canReadManagement(role) && !isAdmin) {
    res.status(403).json({ error: "Only owner/admin/analyst can view followers" });
    return;
  }

  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50,
    200,
  );
  const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) || 0 : 0;

  const rows = await db
    .select()
    .from(businessFollowsTable)
    .where(eq(businessFollowsTable.businessId, biz.id))
    .orderBy(desc(businessFollowsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users =
    userIds.length > 0
      ? await db
          .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
          .from(usersTable)
          .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(userIds.map((id) => sql`${id}`), sql`, `)}]::int[])`)
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  res.json({
    followerCount: biz.followerCount,
    followers: rows.map((r) => ({
      userId: r.userId,
      userName: userMap.get(r.userId)?.name ?? "Unknown",
      userPhotoUrl: userMap.get(r.userId)?.profilePhotoUrl ?? null,
      followedAt: r.createdAt.toISOString(),
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Save / Unsave — same idempotent pattern as follow
// ─────────────────────────────────────────────────────────────────────────────

router.post("/businesses/:handle/save", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz || !biz.isPublished || biz.status !== "active") {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const { active, saveCount, didSave } = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(businessSavesTable)
      .where(
        and(
          eq(businessSavesTable.businessId, biz.id),
          eq(businessSavesTable.userId, user.id),
        ),
      )
      .returning({ id: businessSavesTable.id });

    if (deleted.length > 0) {
      const [row] = await tx
        .update(businessesTable)
        .set({ saveCount: sql`greatest(${businessesTable.saveCount} - 1, 0)` })
        .where(eq(businessesTable.id, biz.id))
        .returning({ saveCount: businessesTable.saveCount });
      return { active: false, saveCount: row.saveCount, didSave: false };
    }

    const inserted = await tx
      .insert(businessSavesTable)
      .values({ businessId: biz.id, userId: user.id })
      .onConflictDoNothing()
      .returning({ id: businessSavesTable.id });

    if (inserted.length > 0) {
      const [row] = await tx
        .update(businessesTable)
        .set({ saveCount: sql`${businessesTable.saveCount} + 1` })
        .where(eq(businessesTable.id, biz.id))
        .returning({ saveCount: businessesTable.saveCount });
      return { active: true, saveCount: row.saveCount, didSave: true };
    }

    const [row] = await tx
      .select({ saveCount: businessesTable.saveCount })
      .from(businessesTable)
      .where(eq(businessesTable.id, biz.id));
    return { active: true, saveCount: row.saveCount, didSave: false };
  });

  if (didSave) {
    void recordInsightEvent(biz.id, "save", user.id);
  }

  res.json({ active, saveCount });
});

// ─────────────────────────────────────────────────────────────────────────────
// Check-in (active+published pages only)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/businesses/:handle/checkin", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz || !biz.isPublished || biz.status !== "active") {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const note = typeof req.body?.note === "string" ? req.body.note.trim() || null : null;
  const visibility = req.body?.visibility === "private" ? "private" : "public";
  const shareToFeed = Boolean(req.body?.shareToFeed);

  // Optional managed photo — validated as an internal object owned by the user.
  let photoUrl: string | null = null;
  const rawPhoto =
    typeof req.body?.photoUrl === "string" && req.body.photoUrl ? req.body.photoUrl : null;
  if (rawPhoto) {
    if (!toObjectEntityPath(rawPhoto)) {
      res.status(400).json({
        error: "photoUrl must reference an uploaded storage object; external URLs are not allowed",
      });
      return;
    }
    try {
      photoUrl = await finalizeUploadedImage(rawPhoto, user.id);
    } catch (err) {
      if (err instanceof InvalidUploadError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  }

  // Optional friend tags — validated against real friendships (canonical
  // ordering userAId<userBId). Non-friends are silently dropped.
  let taggedUserIds: number[] | null = null;
  const rawTags = Array.isArray(req.body?.taggedUserIds)
    ? (req.body.taggedUserIds as unknown[]).filter((n): n is number => typeof n === "number")
    : [];
  if (rawTags.length > 0) {
    const uniq = [...new Set(rawTags)].filter((id) => id !== user.id);
    if (uniq.length > 0) {
      const pairs = uniq.map((id) => ({
        a: Math.min(user.id, id),
        b: Math.max(user.id, id),
      }));
      const friendships = await db
        .select({ a: friendshipsTable.userAId, b: friendshipsTable.userBId })
        .from(friendshipsTable)
        .where(
          or(
            ...pairs.map((p) =>
              and(eq(friendshipsTable.userAId, p.a), eq(friendshipsTable.userBId, p.b)),
            ),
          )!,
        );
      const friendSet = new Set<number>();
      for (const f of friendships) {
        friendSet.add(f.a === user.id ? f.b : f.a);
      }
      const validated = uniq.filter((id) => friendSet.has(id));
      taggedUserIds = validated.length > 0 ? validated : null;
    }
  }

  // Insert + counter increment are atomic; count can't drift from row set.
  // A public check-in with shareToFeed also creates a linked canonical feed
  // item attributed to the checking-in user (private check-ins never do).
  const { checkIn, checkInCount } = await db.transaction(async (tx) => {
    const [ci] = await tx
      .insert(businessCheckInsTable)
      .values({ businessId: biz.id, userId: user.id, note, visibility, shareToFeed, photoUrl, taggedUserIds })
      .returning();
    const [row] = await tx
      .update(businessesTable)
      .set({ checkInCount: sql`${businessesTable.checkInCount} + 1` })
      .where(eq(businessesTable.id, biz.id))
      .returning({ checkInCount: businessesTable.checkInCount });

    if (shareToFeed && visibility === "public") {
      const feedText = note && note.length > 0 ? `Checked in at ${biz.name}: ${note}` : `Checked in at ${biz.name}`;
      const [feedRow] = await tx
        .insert(feedPostsTable)
        .values({
          userId: user.id,
          userRole: user.role,
          text: feedText,
          mediaUrl: photoUrl,
          mediaType: photoUrl ? "image" : "none",
          category: "checkin",
          source: "business_checkin",
          sourceId: ci.id,
          businessId: biz.id,
          isHookahRelatedConfirmed: true,
          status: "active",
          audience: "public",
        })
        .returning({ id: feedPostsTable.id });
      await tx
        .update(businessCheckInsTable)
        .set({ feedPostId: feedRow.id })
        .where(eq(businessCheckInsTable.id, ci.id));
      ci.feedPostId = feedRow.id;
    }
    return { checkIn: ci, checkInCount: row.checkInCount };
  });

  void recordInsightEvent(biz.id, "checkin", user.id);
  void notifyBusinessTeam(
    biz.id,
    "new_checkin",
    "New check-in",
    `${user.name} checked in to your business`,
    { relatedEntityId: checkIn.id, relatedEntityType: "checkin" },
  );

  res.status(201).json({
    id: checkIn.id,
    businessId: checkIn.businessId,
    userId: checkIn.userId,
    note: checkIn.note ?? null,
    visibility: checkIn.visibility,
    shareToFeed: checkIn.shareToFeed,
    photoUrl: checkIn.photoUrl ?? null,
    taggedUserIds: checkIn.taggedUserIds ?? [],
    feedPostId: checkIn.feedPostId ?? null,
    checkInCount,
    createdAt: checkIn.createdAt.toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Check-in lists
//   GET .../checkins            → team/admin: all check-ins (management)
//   GET .../checkins/recent     → public: recent PUBLIC check-ins only
// ─────────────────────────────────────────────────────────────────────────────

router.get("/businesses/:handle/checkins", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const role = await getTeamRole(biz.id, user.id);
  const isAdmin = user.role === "admin";
  if (!canReadManagement(role) && !isAdmin) {
    res.status(403).json({ error: "Only owner/admin/analyst can view check-ins" });
    return;
  }

  const rows = await db
    .select()
    .from(businessCheckInsTable)
    .where(eq(businessCheckInsTable.businessId, biz.id))
    .orderBy(desc(businessCheckInsTable.createdAt))
    .limit(100);

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users =
    userIds.length > 0
      ? await db
          .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
          .from(usersTable)
          .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(userIds.map((id) => sql`${id}`), sql`, `)}]::int[])`)
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  res.json(
    rows.map((r) => ({
      id: r.id,
      businessId: r.businessId,
      userId: r.userId,
      userName: userMap.get(r.userId)?.name ?? "Unknown",
      userPhotoUrl: userMap.get(r.userId)?.profilePhotoUrl ?? null,
      note: r.note ?? null,
      visibility: r.visibility,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

router.get("/businesses/:handle/checkins/recent", async (req, res): Promise<void> => {
  const handle = parseHandle(req.params.handle);
  const viewer = await getSessionUser(req);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const { allowed } = await resolveChildReadAccess(biz, viewer);
  if (!allowed) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  // Public recent list EXCLUDES private check-ins.
  const rows = await db
    .select()
    .from(businessCheckInsTable)
    .where(
      and(
        eq(businessCheckInsTable.businessId, biz.id),
        eq(businessCheckInsTable.visibility, "public"),
      ),
    )
    .orderBy(desc(businessCheckInsTable.createdAt))
    .limit(20);

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users =
    userIds.length > 0
      ? await db
          .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
          .from(usersTable)
          .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(userIds.map((id) => sql`${id}`), sql`, `)}]::int[])`)
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const viewerStates = await loadChildViewerStates(
    viewer?.id,
    "checkin",
    rows.map((r) => r.id),
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      businessId: r.businessId,
      userId: r.userId,
      userName: userMap.get(r.userId)?.name ?? "Unknown",
      userPhotoUrl: userMap.get(r.userId)?.profilePhotoUrl ?? null,
      note: r.note ?? null,
      photoUrl: r.photoUrl ?? null,
      likeCount: r.likeCount,
      commentCount: r.commentCount,
      viewerLiked: viewerStates.get(r.id)?.liked ?? false,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Reviews
// Unique DB constraint on (businessId, userId) enforces one review per user.
// Review count + average are recomputed in the same UPDATE using a subquery.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/businesses/:handle/reviews", async (req, res): Promise<void> => {
  const handle = parseHandle(req.params.handle);
  const viewer = await getSessionUser(req);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
  if (!allowed) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  // Public sees only active reviews; team/admin management view also sees hidden.
  const statusCondition = isManagementView
    ? or(
        eq(businessReviewsTable.status, "active"),
        eq(businessReviewsTable.status, "hidden"),
      )!
    : eq(businessReviewsTable.status, "active");

  const reviews = await db
    .select()
    .from(businessReviewsTable)
    .where(and(eq(businessReviewsTable.businessId, biz.id), statusCondition))
    .orderBy(desc(businessReviewsTable.createdAt))
    .limit(50);

  if (reviews.length === 0) {
    res.json([]);
    return;
  }

  const userIds = [...new Set(reviews.map((r) => r.userId))];
  const users = await db
    .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
    .from(usersTable)
    .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(userIds.map((id) => sql`${id}`), sql`, `)}]::int[])`);
  const userMap = new Map(users.map((u) => [u.id, u]));

  const reviewIds = reviews.map((r) => r.id);
  const replies = await db
    .select()
    .from(businessReviewRepliesTable)
    .where(
      sql`${businessReviewRepliesTable.reviewId} = ANY(ARRAY[${sql.join(reviewIds.map((id) => sql`${id}`), sql`, `)}]::int[])`,
    );
  const replyMap = new Map(replies.map((r) => [r.reviewId, r]));

  res.json(
    reviews.map((r) =>
      serializeReview(r, userMap.get(r.userId) ?? null, replyMap.get(r.id) ?? null),
    ),
  );
});

router.post("/businesses/:handle/reviews", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz || !biz.isPublished || biz.status !== "active") {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const ratingRaw = req.body?.rating;
  const rating =
    typeof ratingRaw === "number" ? Math.trunc(ratingRaw) : parseInt(String(ratingRaw), 10);
  if (isNaN(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "rating must be an integer between 1 and 5" });
    return;
  }

  const text =
    typeof req.body?.text === "string" && req.body.text.trim()
      ? req.body.text.trim()
      : null;

  // Insert (unique-index guarded) + aggregate recompute run atomically so
  // reviewCount/averageRating always reflect the committed review set.
  const review = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(businessReviewsTable)
      .values({ businessId: biz.id, userId: user.id, rating, text })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) return null;

    await tx
      .update(businessesTable)
      .set({
        reviewCount: sql`(
          SELECT count(*)::int FROM business_reviews
          WHERE business_id = ${biz.id} AND status = 'active'
        )`,
        averageRating: sql`(
          SELECT AVG(rating)::numeric(3,2) FROM business_reviews
          WHERE business_id = ${biz.id} AND status = 'active'
        )`,
      })
      .where(eq(businessesTable.id, biz.id));

    return inserted[0];
  });

  if (!review) {
    res.status(400).json({ error: "You have already reviewed this business" });
    return;
  }

  void recordInsightEvent(biz.id, "review", user.id);
  void notifyBusinessTeam(
    biz.id,
    "new_review",
    "New review",
    `${user.name} left a ${rating}-star review`,
    { relatedEntityId: review.id, relatedEntityType: "review" },
  );

  res.status(201).json(
    serializeReview(
      review,
      { name: user.name, profilePhotoUrl: user.profilePhotoUrl ?? null },
      null,
    ),
  );
});

router.post(
  "/businesses/:handle/reviews/:reviewId/reply",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const reviewId = parseId(req.params.reviewId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const role = await getTeamRole(biz.id, user.id);
    if (!canModerateContent(role) && user.role !== "admin") {
      res.status(403).json({ error: "Only business owner/admin/moderator can reply to reviews" });
      return;
    }

    if (isWriteBlocked(biz, user.role === "admin")) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }

    const [review] = await db
      .select()
      .from(businessReviewsTable)
      .where(and(eq(businessReviewsTable.id, reviewId), eq(businessReviewsTable.businessId, biz.id)));

    if (!review || review.status !== "active") {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    // DB UNIQUE on reviewId enforces one reply per review
    const replyInserted = await db
      .insert(businessReviewRepliesTable)
      .values({ reviewId, ownerUserId: user.id, text })
      .onConflictDoNothing()
      .returning();

    if (replyInserted.length === 0) {
      res.status(400).json({ error: "A reply already exists for this review" });
      return;
    }

    const reply = replyInserted[0];
    // ownerUserId omitted from public reply output
    res.status(201).json({
      id: reply.id,
      reviewId: reply.reviewId,
      text: reply.text,
      createdAt: reply.createdAt.toISOString(),
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Business Posts
// mediaType validated; images/videos finalized via storage; removed is terminal
// ─────────────────────────────────────────────────────────────────────────────

const VALID_MEDIA_TYPES = new Set(["none", "image", "video"]);

router.get("/businesses/:handle/posts", async (req, res): Promise<void> => {
  const handle = parseHandle(req.params.handle);
  const viewer = await getSessionUser(req);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
  if (!allowed) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  // Public: active posts only; management view also sees hidden (never removed).
  const statusCondition = isManagementView
    ? or(
        eq(businessPostsTable.status, "active"),
        eq(businessPostsTable.status, "hidden"),
      )!
    : eq(businessPostsTable.status, "active");

  const posts = await db
    .select()
    .from(businessPostsTable)
    .where(and(eq(businessPostsTable.businessId, biz.id), statusCondition))
    .orderBy(desc(businessPostsTable.isPinned), desc(businessPostsTable.createdAt))
    .limit(50);

  if (posts.length === 0) {
    res.json([]);
    return;
  }

  const authorIds = [...new Set(posts.map((p) => p.authorUserId))];
  const authors = await db
    .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
    .from(usersTable)
    .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(authorIds.map((id) => sql`${id}`), sql`, `)}]::int[])`);
  const authorMap = new Map(authors.map((a) => [a.id, a]));

  const viewerLikedSet = new Set<number>();
  const viewerSavedSet = new Set<number>();
  if (viewer?.id) {
    const postIds = posts.map((p) => p.id);
    const idArray = sql`ARRAY[${sql.join(postIds.map((id) => sql`${id}`), sql`, `)}]::int[]`;
    const [likes, saves] = await Promise.all([
      db
        .select({ postId: businessPostLikesTable.postId })
        .from(businessPostLikesTable)
        .where(
          and(
            eq(businessPostLikesTable.userId, viewer.id),
            sql`${businessPostLikesTable.postId} = ANY(${idArray})`,
          ),
        ),
      db
        .select({ postId: businessPostSavesTable.postId })
        .from(businessPostSavesTable)
        .where(
          and(
            eq(businessPostSavesTable.userId, viewer.id),
            sql`${businessPostSavesTable.postId} = ANY(${idArray})`,
          ),
        ),
    ]);
    likes.forEach((l) => viewerLikedSet.add(l.postId));
    saves.forEach((s) => viewerSavedSet.add(s.postId));
  }

  res.json(
    posts.map((p) => {
      const author = authorMap.get(p.authorUserId);
      return {
        id: p.id,
        businessId: p.businessId,
        authorUserId: p.authorUserId,
        authorName: author?.name ?? "Unknown",
        authorPhotoUrl: author?.profilePhotoUrl ?? null,
        text: p.text,
        mediaUrl: p.mediaUrl ?? null,
        posterUrl: p.posterUrl ?? null,
        mediaType: p.mediaType,
        status: p.status,
        isPinned: p.isPinned,
        likeCount: p.likeCount,
        commentCount: p.commentCount,
        viewerLiked: viewerLikedSet.has(p.id),
        viewerSaved: viewerSavedSet.has(p.id),
        createdAt: p.createdAt.toISOString(),
      };
    }),
  );
});

router.post("/businesses/:handle/posts", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const role = await getTeamRole(biz.id, user.id);
  if (!canEditContent(role) && user.role !== "admin") {
    res.status(403).json({ error: "Only team members (owner/admin/editor) can post on behalf of a business" });
    return;
  }

  if (isWriteBlocked(biz, user.role === "admin")) {
    res.status(409).json({ error: `Business is ${biz.status} and cannot accept new posts` });
    return;
  }

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  // mediaType must be one of the allowed enum values
  const mediaTypeRaw = typeof req.body?.mediaType === "string" ? req.body.mediaType : "none";
  if (!VALID_MEDIA_TYPES.has(mediaTypeRaw)) {
    res.status(400).json({ error: "mediaType must be one of: none, image, video" });
    return;
  }

  const rawMediaUrl = typeof req.body?.mediaUrl === "string" && req.body.mediaUrl ? req.body.mediaUrl : null;
  const rawPosterUrl = typeof req.body?.posterUrl === "string" && req.body.posterUrl ? req.body.posterUrl : null;

  // mediaType=none forbids any media URL entirely.
  if (mediaTypeRaw === "none" && (rawMediaUrl || rawPosterUrl)) {
    res.status(400).json({ error: "mediaType 'none' cannot include a mediaUrl or posterUrl" });
    return;
  }
  if (mediaTypeRaw !== "none" && !rawMediaUrl) {
    res.status(400).json({ error: `mediaType '${mediaTypeRaw}' requires a mediaUrl` });
    return;
  }
  // Reject arbitrary external URLs up-front: media must be an internal storage
  // object path (/api/storage/objects/... or /objects/...). No pass-through.
  if (rawMediaUrl && !toObjectEntityPath(rawMediaUrl)) {
    res.status(400).json({
      error: "mediaUrl must reference an uploaded storage object; external URLs are not allowed",
    });
    return;
  }
  if (rawPosterUrl && !toObjectEntityPath(rawPosterUrl)) {
    res.status(400).json({
      error: "posterUrl must reference an uploaded storage object; external URLs are not allowed",
    });
    return;
  }

  let mediaUrl: string | null = null;
  let posterUrl: string | null = null;

  try {
    if (mediaTypeRaw === "image") {
      // Image: sniff bytes, must be an allowed image type, set public ACL.
      mediaUrl = await finalizeUploadedImage(rawMediaUrl!, user.id);
    } else if (mediaTypeRaw === "video") {
      // Video: must be a managed uploaded/transcoded internal storage object.
      // finalizeMediaUrlWithVideoTranscode sniffs bytes (rejects images),
      // transcodes raw uploads to H.264 MP4, and returns a generated poster.
      const result = await finalizeMediaUrlWithVideoTranscode(rawMediaUrl!, user.id, "video");
      mediaUrl = result.url;
      // Prefer the pipeline-generated poster; otherwise finalize a supplied one.
      if (result.posterUrl) {
        posterUrl = result.posterUrl;
      } else if (rawPosterUrl) {
        posterUrl = await finalizeUploadedImage(rawPosterUrl, user.id);
      }
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  // Only publicly-live pages produce a canonical feed item.
  const pageIsLive = biz.isPublished && biz.status === "active";

  const post = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(businessPostsTable)
      .values({
        businessId: biz.id,
        authorUserId: user.id,
        text,
        mediaUrl,
        posterUrl,
        mediaType: mediaTypeRaw,
      })
      .returning();
    await tx
      .update(businessesTable)
      .set({ postCount: sql`${businessesTable.postCount} + 1` })
      .where(eq(businessesTable.id, biz.id));

    // Canonical feed linkage — publicly attributed to the Business Page.
    // userId is the page owner (needed for the not-null column) but userRole
    // "business" + source/businessId mark it as business-authored so the feed
    // serializer surfaces the page, NOT the owner's personal identity.
    if (pageIsLive) {
      const [feedRow] = await tx
        .insert(feedPostsTable)
        .values({
          userId: biz.ownerUserId,
          userRole: "business",
          text,
          mediaUrl,
          posterUrl,
          mediaType: mediaTypeRaw,
          category: "business",
          source: "business_post",
          sourceId: p.id,
          businessId: biz.id,
          isHookahRelatedConfirmed: true,
          status: "active",
          audience: "public",
        })
        .returning({ id: feedPostsTable.id });
      await tx
        .update(businessPostsTable)
        .set({ feedPostId: feedRow.id })
        .where(eq(businessPostsTable.id, p.id));
      p.feedPostId = feedRow.id;

      // Parse + record business @-mentions in the post text.
      await createBusinessMentions(tx, {
        text,
        sourceType: "business_post",
        sourceId: p.id,
        authorUserId: user.id,
        excludeBusinessId: biz.id,
      });
    }
    return p;
  });

  res.status(201).json({
    id: post.id,
    businessId: post.businessId,
    authorUserId: post.authorUserId,
    authorName: user.name,
    authorPhotoUrl: user.profilePhotoUrl ?? null,
    text: post.text,
    mediaUrl: post.mediaUrl ?? null,
    posterUrl: post.posterUrl ?? null,
    mediaType: post.mediaType,
    status: post.status,
    isPinned: post.isPinned,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    viewerLiked: false,
    createdAt: post.createdAt.toISOString(),
  });
});

router.delete(
  "/businesses/:handle/posts/:postId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const postId = parseId(req.params.postId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canEditContent(role) && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    // Suspended/closed pages block team mutations (admin platform bypasses).
    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }

    const [post] = await db
      .select()
      .from(businessPostsTable)
      .where(and(eq(businessPostsTable.id, postId), eq(businessPostsTable.businessId, biz.id)));

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    // A moderation-locked (admin-hidden/removed) post cannot be touched by team.
    if (post.moderationLocked && !isAdmin) {
      res.status(409).json({ error: "This post is locked by platform moderation" });
      return;
    }

    if (post.status === "removed") {
      // Already removed — idempotent success
      res.sendStatus(204);
      return;
    }

    await db.transaction(async (tx) => {
      // Conditional flip from a counted state; RETURNING confirms exactly which
      // rows changed so the postCount decrement happens at most once even under
      // concurrent deletes.
      const flippedActive = await tx
        .update(businessPostsTable)
        .set({ status: "removed" })
        .where(
          and(
            eq(businessPostsTable.id, postId),
            eq(businessPostsTable.status, "active"),
          ),
        )
        .returning({ id: businessPostsTable.id, feedPostId: businessPostsTable.feedPostId });
      if (flippedActive.length > 0) {
        await tx
          .update(businessesTable)
          .set({ postCount: sql`greatest(${businessesTable.postCount} - 1, 0)` })
          .where(eq(businessesTable.id, biz.id));
      } else {
        // Not active (hidden) — remove without decrementing.
        await tx
          .update(businessPostsTable)
          .set({ status: "removed" })
          .where(
            and(
              eq(businessPostsTable.id, postId),
              sql`${businessPostsTable.status} <> 'removed'`,
            ),
          );
      }
      // Transactionally hide the linked canonical feed item, if any.
      if (post.feedPostId != null) {
        await tx
          .update(feedPostsTable)
          .set({ status: "removed" })
          .where(eq(feedPostsTable.id, post.feedPostId));
      }
    });

    res.sendStatus(204);
  },
);

router.post(
  "/businesses/:handle/posts/:postId/pin",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const postId = parseId(req.params.postId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const role = await getTeamRole(biz.id, user.id);
    if (!canManageSettings(role) && user.role !== "admin") {
      res.status(403).json({ error: "Only owner/admin can pin posts" });
      return;
    }

    if (isWriteBlocked(biz, user.role === "admin")) {
      res.status(409).json({ error: `Business is ${biz.status}` });
      return;
    }

    const [post] = await db
      .select()
      .from(businessPostsTable)
      .where(and(eq(businessPostsTable.id, postId), eq(businessPostsTable.businessId, biz.id)));

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    if (post.status === "removed") {
      res.status(409).json({ error: "Cannot pin a removed post" });
      return;
    }
    if (post.moderationLocked && user.role !== "admin") {
      res.status(409).json({ error: "This post is locked by platform moderation" });
      return;
    }

    const newPinned = !post.isPinned;
    await db
      .update(businessPostsTable)
      .set({ isPinned: newPinned })
      .where(eq(businessPostsTable.id, postId));

    res.json({ active: newPinned, isPinned: newPinned });
  },
);

router.post(
  "/businesses/:handle/posts/:postId/hide",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const postId = parseId(req.params.postId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canModerateContent(role) && !isAdmin) {
      res.status(403).json({ error: "Only owner/admin/moderator can hide posts" });
      return;
    }

    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }

    const [post] = await db
      .select()
      .from(businessPostsTable)
      .where(and(eq(businessPostsTable.id, postId), eq(businessPostsTable.businessId, biz.id)));

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    // removed is terminal — team cannot restore it
    if (post.status === "removed") {
      res.status(409).json({ error: "Cannot toggle a post that has been permanently removed" });
      return;
    }
    // Admin-hidden (moderation-locked) posts cannot be un-hidden by team.
    if (post.moderationLocked && !isAdmin) {
      res.status(409).json({ error: "This post was hidden by platform moderation and cannot be restored by the team" });
      return;
    }

    const newStatus = post.status === "hidden" ? "active" : "hidden";
    await db
      .update(businessPostsTable)
      .set({ status: newStatus })
      .where(eq(businessPostsTable.id, postId));

    res.json({ active: newStatus === "active", isHidden: newStatus === "hidden" });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Post engagement — like, comment, save, report
// Guards: post must be visible to the actor. Public actors require the page to
// be active+published AND the post active. Team/admin may act on management view.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads a post and asserts the actor may engage with it. Returns the post row
 * or writes a 404/409 and returns null. Public engagement requires an active
 * post on an active+published page; team members may engage in management view
 * with active/hidden posts (never removed).
 */
async function loadEngageablePost(
  biz: typeof businessesTable.$inferSelect,
  postId: number,
  viewer: { id: number; role?: string | null },
  res: import("express").Response,
): Promise<typeof businessPostsTable.$inferSelect | null> {
  const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
  if (!allowed) {
    res.status(404).json({ error: "Business not found" });
    return null;
  }
  const [post] = await db
    .select()
    .from(businessPostsTable)
    .where(and(eq(businessPostsTable.id, postId), eq(businessPostsTable.businessId, biz.id)));
  if (!post || post.status === "removed") {
    res.status(404).json({ error: "Post not found" });
    return null;
  }
  // Public (non-team) actors cannot engage with hidden posts.
  if (post.status !== "active" && !isManagementView) {
    res.status(404).json({ error: "Post not found" });
    return null;
  }
  return post;
}

// Like toggle — idempotent; unique (postId,userId); transactional counter.
router.post(
  "/businesses/:handle/posts/:postId/like",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const postId = parseId(req.params.postId);
    const post = await loadEngageablePost(biz, postId, user, res);
    if (!post) return;

    const { active, likeCount } = await db.transaction(async (tx) => {
      // Attempt an INSERT; ON CONFLICT DO NOTHING + RETURNING tells us whether a
      // NEW row was actually created. If zero rows returned, the like already
      // existed → toggle OFF via DELETE ... RETURNING. Counter changes strictly
      // follow the confirmed row mutation (no stale pre-read race).
      const insertedLike = await tx
        .insert(businessPostLikesTable)
        .values({ postId, userId: user.id })
        .onConflictDoNothing()
        .returning({ id: businessPostLikesTable.id });

      let didLike: boolean;
      if (insertedLike.length > 0) {
        didLike = true;
      } else {
        const deleted = await tx
          .delete(businessPostLikesTable)
          .where(
            and(
              eq(businessPostLikesTable.postId, postId),
              eq(businessPostLikesTable.userId, user.id),
            ),
          )
          .returning({ id: businessPostLikesTable.id });
        // If neither insert nor delete changed a row (extremely rare race), do
        // NOT touch the counter; report current state.
        if (deleted.length === 0) {
          const [cur] = await tx
            .select({ likeCount: businessPostsTable.likeCount })
            .from(businessPostsTable)
            .where(eq(businessPostsTable.id, postId));
          return { active: false, likeCount: cur?.likeCount ?? 0 };
        }
        didLike = false;
      }
      const [row] = await tx
        .update(businessPostsTable)
        .set({
          likeCount: didLike
            ? sql`${businessPostsTable.likeCount} + 1`
            : sql`greatest(${businessPostsTable.likeCount} - 1, 0)`,
        })
        .where(eq(businessPostsTable.id, postId))
        .returning({ likeCount: businessPostsTable.likeCount });
      return { active: didLike, likeCount: row.likeCount };
    });

    res.json({ active, likeCount });
  },
);

// Save toggle — idempotent; unique (postId,userId).
router.post(
  "/businesses/:handle/posts/:postId/save",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const postId = parseId(req.params.postId);
    const post = await loadEngageablePost(biz, postId, user, res);
    if (!post) return;

    // Confirm the actual row change via INSERT ... RETURNING; fall back to
    // DELETE ... RETURNING to toggle off. No stale pre-read.
    const inserted = await db
      .insert(businessPostSavesTable)
      .values({ postId, userId: user.id })
      .onConflictDoNothing()
      .returning({ id: businessPostSavesTable.id });
    let active: boolean;
    if (inserted.length > 0) {
      active = true;
    } else {
      const deleted = await db
        .delete(businessPostSavesTable)
        .where(
          and(
            eq(businessPostSavesTable.postId, postId),
            eq(businessPostSavesTable.userId, user.id),
          ),
        )
        .returning({ id: businessPostSavesTable.id });
      active = deleted.length === 0 ? false : false;
    }
    res.json({ active });
  },
);

// Report — one per (post,user); idempotent success on duplicate.
router.post(
  "/businesses/:handle/posts/:postId/report",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const postId = parseId(req.params.postId);
    const post = await loadEngageablePost(biz, postId, user, res);
    if (!post) return;

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    const details = typeof req.body?.details === "string" ? req.body.details.trim() || null : null;

    const inserted = await db
      .insert(businessPostReportsTable)
      .values({ postId, userId: user.id, reason, details })
      .onConflictDoNothing()
      .returning();

    // Idempotent: duplicate report returns 200 with alreadyReported flag.
    res.status(inserted.length > 0 ? 201 : 200).json({
      reported: true,
      alreadyReported: inserted.length === 0,
    });
  },
);

// Comment list — public sees active comments; team/admin also see hidden.
router.get(
  "/businesses/:handle/posts/:postId/comments",
  async (req, res): Promise<void> => {
    const viewer = await getSessionUser(req);
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
    if (!allowed) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const postId = parseId(req.params.postId);
    const [post] = await db
      .select({ id: businessPostsTable.id, status: businessPostsTable.status })
      .from(businessPostsTable)
      .where(and(eq(businessPostsTable.id, postId), eq(businessPostsTable.businessId, biz.id)));
    if (!post || (post.status !== "active" && !isManagementView)) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const statusCondition = isManagementView
      ? or(
          eq(businessPostCommentsTable.status, "active"),
          eq(businessPostCommentsTable.status, "hidden"),
        )!
      : eq(businessPostCommentsTable.status, "active");

    const comments = await db
      .select()
      .from(businessPostCommentsTable)
      .where(and(eq(businessPostCommentsTable.postId, postId), statusCondition))
      .orderBy(asc(businessPostCommentsTable.createdAt))
      .limit(200);

    const userIds = [...new Set(comments.map((c) => c.userId))];
    const users =
      userIds.length > 0
        ? await db
            .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
            .from(usersTable)
            .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(userIds.map((id) => sql`${id}`), sql`, `)}]::int[])`)
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    res.json(
      comments.map((c) => ({
        id: c.id,
        postId: c.postId,
        userId: c.userId,
        userName: userMap.get(c.userId)?.name ?? "Unknown",
        userPhotoUrl: userMap.get(c.userId)?.profilePhotoUrl ?? null,
        text: c.text,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
    );
  },
);

// Comment create — transactional counter; any authed user on visible post.
router.post(
  "/businesses/:handle/posts/:postId/comments",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const postId = parseId(req.params.postId);
    const post = await loadEngageablePost(biz, postId, user, res);
    if (!post) return;

    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    const comment = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(businessPostCommentsTable)
        .values({ postId, userId: user.id, text })
        .returning();
      await tx
        .update(businessPostsTable)
        .set({ commentCount: sql`${businessPostsTable.commentCount} + 1` })
        .where(eq(businessPostsTable.id, postId));
      return c;
    });

    res.status(201).json({
      id: comment.id,
      postId: comment.postId,
      userId: comment.userId,
      userName: user.name,
      userPhotoUrl: user.profilePhotoUrl ?? null,
      text: comment.text,
      status: comment.status,
      createdAt: comment.createdAt.toISOString(),
    });
  },
);

// Comment delete — author may delete own; team moderators may remove any.
// Admin-removed comments are moderation-locked (team cannot alter).
router.delete(
  "/businesses/:handle/posts/:postId/comments/:commentId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const isAdmin = user.role === "admin";
    const postId = parseId(req.params.postId);
    const commentId = parseId(req.params.commentId);

    const [comment] = await db
      .select()
      .from(businessPostCommentsTable)
      .where(
        and(eq(businessPostCommentsTable.id, commentId), eq(businessPostCommentsTable.postId, postId)),
      );
    if (!comment || comment.status === "removed") {
      res.sendStatus(204); // idempotent
      return;
    }

    const role = await getTeamRole(biz.id, user.id);
    const isAuthor = comment.userId === user.id;
    const canModerate = canModerateContent(role) || isAdmin;
    if (!isAuthor && !canModerate) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    // Team writes blocked when suspended/closed (author self-delete still allowed).
    if (!isAuthor && isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }
    // Moderation lock: only admin may remove/alter an admin-removed comment.
    if (comment.moderationLocked && !isAdmin) {
      res.status(409).json({ error: "This comment is locked by platform moderation" });
      return;
    }

    await db.transaction(async (tx) => {
      // Conditional soft-delete: only rows still in the counted state ("active")
      // are flipped, and the RETURNING result confirms the flip. Decrement runs
      // exactly once, driven by the rows this statement actually changed —
      // concurrent deletes cannot both decrement.
      const flippedActive = await tx
        .update(businessPostCommentsTable)
        .set({ status: "removed", moderationLocked: isAdmin ? true : comment.moderationLocked })
        .where(
          and(
            eq(businessPostCommentsTable.id, commentId),
            eq(businessPostCommentsTable.status, "active"),
          ),
        )
        .returning({ id: businessPostCommentsTable.id });
      if (flippedActive.length > 0) {
        await tx
          .update(businessPostsTable)
          .set({ commentCount: sql`greatest(${businessPostsTable.commentCount} - 1, 0)` })
          .where(eq(businessPostsTable.id, postId));
      } else {
        // Not active (e.g. currently "hidden") — remove without decrementing.
        await tx
          .update(businessPostCommentsTable)
          .set({ status: "removed", moderationLocked: isAdmin ? true : comment.moderationLocked })
          .where(
            and(
              eq(businessPostCommentsTable.id, commentId),
              sql`${businessPostCommentsTable.status} <> 'removed'`,
            ),
          );
      }
    });

    res.sendStatus(204);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Services (editor+)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/businesses/:handle/services", async (req, res): Promise<void> => {
  const handle = parseHandle(req.params.handle);
  const viewer = await getSessionUser(req);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
  if (!allowed) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  // Public sees only active services; management view sees inactive too.
  const conditions = [eq(businessServicesTable.businessId, biz.id)];
  if (!isManagementView) conditions.push(eq(businessServicesTable.isActive, true));

  // Public sees only active status; management view sees drafts/archived.
  if (!isManagementView) conditions.push(eq(businessServicesTable.status, "active"));

  const services = await db
    .select()
    .from(businessServicesTable)
    .where(and(...conditions))
    .orderBy(asc(businessServicesTable.sortOrder), asc(businessServicesTable.createdAt));

  res.json(services.map(serializeService));
});

router.post("/businesses/:handle/services", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const role = await getTeamRole(biz.id, user.id);
  if (!canEditContent(role) && user.role !== "admin") {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  if (isWriteBlocked(biz, user.role === "admin")) {
    res.status(409).json({ error: `Business is ${biz.status}` });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : null;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  let bookingUrl: string | null | undefined;
  try {
    if (body.bookingUrl !== undefined) bookingUrl = validateHttpUrl(body.bookingUrl, "bookingUrl");
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  let imageUrl: string | null = null;
  if (typeof body.imageUrl === "string" && body.imageUrl) {
    try {
      imageUrl = await finalizeUploadedImage(body.imageUrl, user.id);
    } catch (err) {
      if (err instanceof InvalidUploadError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  }

  const statusVal =
    typeof body.status === "string" && ["active", "draft", "archived"].includes(body.status)
      ? body.status
      : undefined;

  const id = typeof body.id === "number" ? body.id : null;
  let service: typeof businessServicesTable.$inferSelect;

  if (id) {
    const [existing] = await db
      .select()
      .from(businessServicesTable)
      .where(and(eq(businessServicesTable.id, id), eq(businessServicesTable.businessId, biz.id)));
    if (!existing) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    [service] = await db
      .update(businessServicesTable)
      .set({
        name,
        description: typeof body.description === "string" ? body.description : existing.description,
        category: typeof body.category === "string" ? body.category : existing.category,
        priceLabel: typeof body.priceLabel === "string" ? body.priceLabel : existing.priceLabel,
        priceCents: typeof body.priceCents === "number" ? body.priceCents : existing.priceCents,
        salePriceCents:
          typeof body.salePriceCents === "number" ? body.salePriceCents : existing.salePriceCents,
        durationMinutes:
          typeof body.durationMinutes === "number" ? body.durationMinutes : existing.durationMinutes,
        imageUrl: imageUrl || existing.imageUrl,
        bookingUrl: bookingUrl !== undefined ? bookingUrl : existing.bookingUrl,
        isActive: typeof body.isActive === "boolean" ? body.isActive : existing.isActive,
        status: statusVal ?? existing.status,
        sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : existing.sortOrder,
      })
      .where(eq(businessServicesTable.id, id))
      .returning();
  } else {
    [service] = await db
      .insert(businessServicesTable)
      .values({
        businessId: biz.id,
        name,
        description: typeof body.description === "string" ? body.description : null,
        category: typeof body.category === "string" ? body.category : null,
        priceLabel: typeof body.priceLabel === "string" ? body.priceLabel : null,
        priceCents: typeof body.priceCents === "number" ? body.priceCents : null,
        salePriceCents: typeof body.salePriceCents === "number" ? body.salePriceCents : null,
        durationMinutes: typeof body.durationMinutes === "number" ? body.durationMinutes : null,
        imageUrl,
        bookingUrl: bookingUrl ?? null,
        isActive: typeof body.isActive === "boolean" ? body.isActive : true,
        status: statusVal ?? "active",
        sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
      })
      .returning();
  }

  res.status(200).json(serializeService(service));
});

router.delete(
  "/businesses/:handle/services/:serviceId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const serviceId = parseId(req.params.serviceId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canEditContent(role) && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }

    const [deleted] = await db
      .delete(businessServicesTable)
      .where(
        and(eq(businessServicesTable.id, serviceId), eq(businessServicesTable.businessId, biz.id)),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Service not found" });
      return;
    }

    res.sendStatus(204);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Products (editor+)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/businesses/:handle/products", async (req, res): Promise<void> => {
  const handle = parseHandle(req.params.handle);
  const viewer = await getSessionUser(req);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
  if (!allowed) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  // Public sees only available active products; management view sees all.
  const conditions = [eq(businessProductsTable.businessId, biz.id)];
  if (!isManagementView) {
    conditions.push(eq(businessProductsTable.isAvailable, true));
    conditions.push(eq(businessProductsTable.status, "active"));
  }

  const products = await db
    .select()
    .from(businessProductsTable)
    .where(and(...conditions))
    .orderBy(asc(businessProductsTable.sortOrder), asc(businessProductsTable.createdAt));

  const viewerStates = await loadChildViewerStates(
    viewer?.id,
    "product",
    products.map((p) => p.id),
  );
  res.json(products.map((p) => serializeProduct(p, viewerStates.get(p.id))));
});

router.post("/businesses/:handle/products", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const role = await getTeamRole(biz.id, user.id);
  if (!canEditContent(role) && user.role !== "admin") {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  if (isWriteBlocked(biz, user.role === "admin")) {
    res.status(409).json({ error: `Business is ${biz.status}` });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : null;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  let purchaseUrl: string | null | undefined;
  try {
    if (body.purchaseUrl !== undefined) purchaseUrl = validateHttpUrl(body.purchaseUrl, "purchaseUrl");
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  let imageUrl: string | null = null;
  let imageUrls: string[] | undefined;
  try {
    if (typeof body.imageUrl === "string" && body.imageUrl) {
      imageUrl = await finalizeUploadedImage(body.imageUrl, user.id);
    }
    if (Array.isArray(body.imageUrls)) {
      imageUrls = [];
      for (const u of body.imageUrls as unknown[]) {
        if (typeof u === "string" && u) imageUrls.push(await finalizeUploadedImage(u, user.id));
      }
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const statusVal =
    typeof body.status === "string" && ["active", "draft", "archived"].includes(body.status)
      ? body.status
      : undefined;

  const id = typeof body.id === "number" ? body.id : null;
  let product: typeof businessProductsTable.$inferSelect;

  if (id) {
    const [existing] = await db
      .select()
      .from(businessProductsTable)
      .where(and(eq(businessProductsTable.id, id), eq(businessProductsTable.businessId, biz.id)));
    if (!existing) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    [product] = await db
      .update(businessProductsTable)
      .set({
        name,
        description: typeof body.description === "string" ? body.description : existing.description,
        category: typeof body.category === "string" ? body.category : existing.category,
        priceCents: typeof body.priceCents === "number" ? body.priceCents : existing.priceCents,
        salePriceCents:
          typeof body.salePriceCents === "number" ? body.salePriceCents : existing.salePriceCents,
        priceLabel: typeof body.priceLabel === "string" ? body.priceLabel : existing.priceLabel,
        imageUrl: imageUrl || existing.imageUrl,
        imageUrls: imageUrls !== undefined ? imageUrls : existing.imageUrls,
        purchaseUrl: purchaseUrl !== undefined ? purchaseUrl : existing.purchaseUrl,
        sku: typeof body.sku === "string" ? body.sku : existing.sku,
        isAvailable: typeof body.isAvailable === "boolean" ? body.isAvailable : existing.isAvailable,
        status: statusVal ?? existing.status,
        sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : existing.sortOrder,
      })
      .where(eq(businessProductsTable.id, id))
      .returning();
  } else {
    [product] = await db
      .insert(businessProductsTable)
      .values({
        businessId: biz.id,
        name,
        description: typeof body.description === "string" ? body.description : null,
        category: typeof body.category === "string" ? body.category : null,
        priceCents: typeof body.priceCents === "number" ? body.priceCents : null,
        salePriceCents: typeof body.salePriceCents === "number" ? body.salePriceCents : null,
        priceLabel: typeof body.priceLabel === "string" ? body.priceLabel : null,
        imageUrl,
        imageUrls: imageUrls ?? null,
        purchaseUrl: purchaseUrl ?? null,
        sku: typeof body.sku === "string" ? body.sku : null,
        isAvailable: typeof body.isAvailable === "boolean" ? body.isAvailable : true,
        status: statusVal ?? "active",
        sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
      })
      .returning();
  }

  res.status(200).json(serializeProduct(product));
});

router.delete(
  "/businesses/:handle/products/:productId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const productId = parseId(req.params.productId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canEditContent(role) && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }

    const [deleted] = await db
      .delete(businessProductsTable)
      .where(
        and(eq(businessProductsTable.id, productId), eq(businessProductsTable.businessId, biz.id)),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    res.sendStatus(204);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Offers — advertiser role has access in addition to editor+
// imageUrl requires storage finalization
// ─────────────────────────────────────────────────────────────────────────────

router.get("/businesses/:handle/offers", async (req, res): Promise<void> => {
  const handle = parseHandle(req.params.handle);
  const viewer = await getSessionUser(req);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
  if (!allowed) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const now = new Date();
  // Public sees only active, non-expired offers; management view sees all.
  const conditions = [eq(businessOffersTable.businessId, biz.id)];
  if (!isManagementView) {
    conditions.push(eq(businessOffersTable.isActive, true));
    // Not yet expired.
    conditions.push(
      or(
        sql`${businessOffersTable.expiresAt} IS NULL`,
        sql`${businessOffersTable.expiresAt} > ${now}`,
      )!,
    );
    // Already started (startsAt in the past or unset).
    conditions.push(
      or(
        sql`${businessOffersTable.startsAt} IS NULL`,
        sql`${businessOffersTable.startsAt} <= ${now}`,
      )!,
    );
  }

  const offers = await db
    .select()
    .from(businessOffersTable)
    .where(and(...conditions))
    .orderBy(asc(businessOffersTable.expiresAt), desc(businessOffersTable.createdAt));

  const viewerStates = await loadChildViewerStates(
    viewer?.id,
    "offer",
    offers.map((o) => o.id),
  );
  res.json(offers.map((o) => serializeOffer(o, viewerStates.get(o.id))));
});

router.post("/businesses/:handle/offers", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const role = await getTeamRole(biz.id, user.id);
  if (!canManageOffers(role) && user.role !== "admin") {
    res.status(403).json({ error: "Only owner/admin/editor/advertiser can manage offers" });
    return;
  }

  if (isWriteBlocked(biz, user.role === "admin")) {
    res.status(409).json({ error: `Business is ${biz.status}` });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : null;
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  let redeemUrl: string | null | undefined;
  try {
    if (body.redeemUrl !== undefined) redeemUrl = validateHttpUrl(body.redeemUrl, "redeemUrl");
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  // imageUrl must be a finalized storage object (not arbitrary external URL)
  let imageUrl: string | null = null;
  if (typeof body.imageUrl === "string" && body.imageUrl) {
    try {
      imageUrl = await finalizeUploadedImage(body.imageUrl, user.id);
    } catch (err) {
      if (err instanceof InvalidUploadError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  }

  const id = typeof body.id === "number" ? body.id : null;
  let offer: typeof businessOffersTable.$inferSelect;

  if (id) {
    const [existing] = await db
      .select()
      .from(businessOffersTable)
      .where(and(eq(businessOffersTable.id, id), eq(businessOffersTable.businessId, biz.id)));
    if (!existing) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    [offer] = await db
      .update(businessOffersTable)
      .set({
        title,
        description: typeof body.description === "string" ? body.description : existing.description,
        discountLabel:
          typeof body.discountLabel === "string" ? body.discountLabel : existing.discountLabel,
        code: typeof body.code === "string" ? body.code : existing.code,
        terms: typeof body.terms === "string" ? body.terms : existing.terms,
        redeemUrl: redeemUrl !== undefined ? redeemUrl : existing.redeemUrl,
        imageUrl: imageUrl ?? existing.imageUrl,
        startsAt:
          typeof body.startsAt === "string" ? new Date(body.startsAt) : existing.startsAt,
        expiresAt:
          typeof body.expiresAt === "string" ? new Date(body.expiresAt) : existing.expiresAt,
        isActive: typeof body.isActive === "boolean" ? body.isActive : existing.isActive,
      })
      .where(eq(businessOffersTable.id, id))
      .returning();
  } else {
    [offer] = await db
      .insert(businessOffersTable)
      .values({
        businessId: biz.id,
        title,
        description: typeof body.description === "string" ? body.description : null,
        discountLabel: typeof body.discountLabel === "string" ? body.discountLabel : null,
        code: typeof body.code === "string" ? body.code : null,
        terms: typeof body.terms === "string" ? body.terms : null,
        redeemUrl: redeemUrl ?? null,
        imageUrl,
        startsAt: typeof body.startsAt === "string" ? new Date(body.startsAt) : null,
        expiresAt: typeof body.expiresAt === "string" ? new Date(body.expiresAt) : null,
        isActive: typeof body.isActive === "boolean" ? body.isActive : true,
      })
      .returning();
  }

  res.status(200).json(serializeOffer(offer));
});

router.delete(
  "/businesses/:handle/offers/:offerId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const offerId = parseId(req.params.offerId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canManageOffers(role) && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }

    const [deleted] = await db
      .delete(businessOffersTable)
      .where(and(eq(businessOffersTable.id, offerId), eq(businessOffersTable.businessId, biz.id)))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }

    res.sendStatus(204);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Appointments
// serviceId validated to belong to same business and be active
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/businesses/:handle/appointments",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const role = await getTeamRole(biz.id, user.id);
    const isAdmin = user.role === "admin";
    const canSeeAll = canManageSettings(role) || isAdmin;

    // Team (owner/admin) sees all; others see only their own
    const conditions = [eq(businessAppointmentsTable.businessId, biz.id)];
    if (!canSeeAll) {
      conditions.push(eq(businessAppointmentsTable.userId, user.id));
    }

    const appointments = await db
      .select()
      .from(businessAppointmentsTable)
      .where(and(...conditions))
      .orderBy(desc(businessAppointmentsTable.scheduledAt))
      .limit(100);

    if (appointments.length === 0) {
      res.json([]);
      return;
    }

    const userIds = [...new Set(appointments.map((a) => a.userId))];
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(userIds.map((id) => sql`${id}`), sql`, `)}]::int[])`);
    const userMap = new Map(users.map((u) => [u.id, u]));

    const serviceIds = [...new Set(appointments.filter((a) => a.serviceId).map((a) => a.serviceId!))];
    const services =
      serviceIds.length > 0
        ? await db
            .select({ id: businessServicesTable.id, name: businessServicesTable.name })
            .from(businessServicesTable)
            .where(
              sql`${businessServicesTable.id} = ANY(ARRAY[${sql.join(serviceIds.map((id) => sql`${id}`), sql`, `)}]::int[])`,
            )
        : [];
    const serviceMap = new Map(services.map((s) => [s.id, s]));

    res.json(
      appointments.map((a) => ({
        id: a.id,
        businessId: a.businessId,
        serviceId: a.serviceId ?? null,
        serviceName: a.serviceId ? (serviceMap.get(a.serviceId)?.name ?? null) : null,
        userId: a.userId,
        userName: userMap.get(a.userId)?.name ?? "Unknown",
        scheduledAt: a.scheduledAt.toISOString(),
        durationMinutes: a.durationMinutes ?? null,
        notes: a.notes ?? null,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
      })),
    );
  },
);

router.post(
  "/businesses/:handle/appointments",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const biz = await getBusinessByHandle(handle);

    if (!biz || !isBusinessPubliclyVisible(biz)) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const scheduledAtRaw = req.body?.scheduledAt;
    if (!scheduledAtRaw || typeof scheduledAtRaw !== "string") {
      res.status(400).json({ error: "scheduledAt is required" });
      return;
    }
    const scheduledAt = new Date(scheduledAtRaw);
    if (isNaN(scheduledAt.getTime())) {
      res.status(400).json({ error: "scheduledAt is not a valid date" });
      return;
    }

    // Booking must be enabled and the slot within configured availability.
    const slotError = validateBookingSlot(biz, scheduledAt);
    if (slotError) {
      res.status(400).json({ error: slotError });
      return;
    }

    const serviceIdRaw = typeof req.body?.serviceId === "number" ? req.body.serviceId : null;
    let resolvedServiceId: number | null = null;

    if (serviceIdRaw !== null) {
      // Validate: serviceId must belong to this business and be active
      const [svc] = await db
        .select({ id: businessServicesTable.id })
        .from(businessServicesTable)
        .where(
          and(
            eq(businessServicesTable.id, serviceIdRaw),
            eq(businessServicesTable.businessId, biz.id),
            eq(businessServicesTable.isActive, true),
          ),
        );
      if (!svc) {
        res.status(400).json({
          error: "serviceId does not refer to an active service of this business",
        });
        return;
      }
      resolvedServiceId = svc.id;
    }

    const parsedDuration = parseAppointmentDuration(req.body?.durationMinutes);
    if (!parsedDuration.valid) {
      res.status(400).json({ error: "durationMinutes must be a whole number between 1 and 1440" });
      return;
    }
    const durationMinutes = parsedDuration.value;
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() || null : null;
    const defaultDuration = resolveAppointmentDuration(biz.bookingDefaultDurationMinutes);
    const effectiveDuration = durationMinutes ?? defaultDuration;
    const buffer = biz.bookingBufferMinutes ?? 0;

    // Serialize concurrent bookings for THIS business via a transaction-scoped
    // Postgres advisory lock keyed on the business id. Two simultaneous requests
    // for overlapping slots cannot both pass the conflict check: the second
    // blocks until the first commits, then sees the newly-inserted row.
    let appt;
    try {
      appt = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${biz.id})`);
        const conflict = await hasAppointmentConflict(tx, {
          businessId: biz.id,
          startsAt: scheduledAt,
          durationMinutes: effectiveDuration,
          bufferMinutes: buffer,
          existingDefaultDurationMinutes: defaultDuration,
        });
        if (conflict) {
          throw new ValidationError("That time slot overlaps an existing appointment");
        }
        const [row] = await tx
          .insert(businessAppointmentsTable)
          .values({
            businessId: biz.id,
            serviceId: resolvedServiceId ?? undefined,
            userId: user.id,
            scheduledAt,
            durationMinutes,
            notes,
            status: "pending",
          })
          .returning();
        return row;
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    void notifyBusinessTeam(
      biz.id,
      "new_appointment",
      "New appointment request",
      `${user.name} requested an appointment`,
      { relatedEntityId: appt.id, relatedEntityType: "appointment" },
    );

    let serviceName: string | null = null;
    if (resolvedServiceId) {
      const [svc] = await db
        .select({ name: businessServicesTable.name })
        .from(businessServicesTable)
        .where(eq(businessServicesTable.id, resolvedServiceId));
      serviceName = svc?.name ?? null;
    }

    res.status(201).json({
      id: appt.id,
      businessId: appt.businessId,
      serviceId: appt.serviceId ?? null,
      serviceName,
      userId: appt.userId,
      userName: user.name,
      scheduledAt: appt.scheduledAt.toISOString(),
      durationMinutes: appt.durationMinutes ?? null,
      notes: appt.notes ?? null,
      status: appt.status,
      createdAt: appt.createdAt.toISOString(),
    });
  },
);

router.patch(
  "/businesses/:handle/appointments/:appointmentId/status",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const appointmentId = parseId(req.params.appointmentId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const [appt] = await db
      .select()
      .from(businessAppointmentsTable)
      .where(
        and(
          eq(businessAppointmentsTable.id, appointmentId),
          eq(businessAppointmentsTable.businessId, biz.id),
        ),
      );

    if (!appt) {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }

    const role = await getTeamRole(biz.id, user.id);
    const isAdmin = user.role === "admin";
    const isBizManager = canManageSettings(role) || isAdmin;
    const isApptOwner = appt.userId === user.id;

    // "declined" is a team-only status; "cancelled" is available to the customer.
    const newStatus = typeof req.body?.status === "string" ? req.body.status : null;
    const TEAM_STATUSES = ["confirmed", "cancelled", "completed", "declined"];
    if (!newStatus || !TEAM_STATUSES.includes(newStatus)) {
      res.status(400).json({
        error: "status must be one of: confirmed, cancelled, completed, declined",
      });
      return;
    }

    if (!isBizManager) {
      // Non-manager users (the customer) may only cancel their own appointment.
      if (!isApptOwner || newStatus !== "cancelled") {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      // POLICY: a customer may ALWAYS cancel their own appointment, even when
      // the business is suspended/closed — protects the customer. No write-block.
    } else {
      // POLICY: team-side confirm/complete/cancel/decline is a business mutation
      // and is blocked while the page is suspended/closed (admin bypasses).
      if (isWriteBlocked(biz, isAdmin)) {
        res.status(409).json({ error: `Business is ${biz.status} and cannot manage appointments` });
        return;
      }
    }

    const [updated] = await db
      .update(businessAppointmentsTable)
      .set({ status: newStatus })
      .where(eq(businessAppointmentsTable.id, appointmentId))
      .returning();

    res.json({
      id: updated.id,
      businessId: updated.businessId,
      serviceId: updated.serviceId ?? null,
      serviceName: null,
      userId: updated.userId,
      userName: "",
      scheduledAt: updated.scheduledAt.toISOString(),
      durationMinutes: updated.durationMinutes ?? null,
      notes: updated.notes ?? null,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
    });
  },
);

// Reschedule — changes scheduledAt (and optionally duration).
// Permissions: the customer may reschedule their own appointment; team managers
// may reschedule any. New slot is re-validated against booking availability.
router.patch(
  "/businesses/:handle/appointments/:appointmentId/reschedule",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const appointmentId = parseId(req.params.appointmentId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const [appt] = await db
      .select()
      .from(businessAppointmentsTable)
      .where(
        and(
          eq(businessAppointmentsTable.id, appointmentId),
          eq(businessAppointmentsTable.businessId, biz.id),
        ),
      );
    if (!appt) {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }

    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    const isBizManager = canManageSettings(role) || isAdmin;
    const isApptOwner = appt.userId === user.id;
    if (!isBizManager && !isApptOwner) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    // Rescheduling is a forward-looking booking action; blocked while suspended.
    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot manage appointments` });
      return;
    }
    if (appt.status === "cancelled" || appt.status === "completed" || appt.status === "declined") {
      res.status(409).json({ error: `Cannot reschedule a ${appt.status} appointment` });
      return;
    }

    const scheduledAtRaw = req.body?.scheduledAt;
    if (!scheduledAtRaw || typeof scheduledAtRaw !== "string") {
      res.status(400).json({ error: "scheduledAt is required" });
      return;
    }
    const scheduledAt = new Date(scheduledAtRaw);
    if (isNaN(scheduledAt.getTime())) {
      res.status(400).json({ error: "scheduledAt is not a valid date" });
      return;
    }
    const slotError = validateBookingSlot(biz, scheduledAt);
    if (slotError) {
      res.status(400).json({ error: slotError });
      return;
    }

    const parsedDuration = parseAppointmentDuration(req.body?.durationMinutes);
    if (!parsedDuration.valid) {
      res.status(400).json({ error: "durationMinutes must be a whole number between 1 and 1440" });
      return;
    }
    const durationMinutes = parsedDuration.value;
    const defaultDuration = resolveAppointmentDuration(biz.bookingDefaultDurationMinutes);
    const effectiveDuration =
      durationMinutes ??
      resolveAppointmentDuration(appt.durationMinutes ?? undefined, defaultDuration);
    const buffer = biz.bookingBufferMinutes ?? 0;

    // Same advisory-lock + overlap guard as create, excluding this appointment.
    let updated;
    try {
      updated = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${biz.id})`);
        const conflict = await hasAppointmentConflict(tx, {
          businessId: biz.id,
          startsAt: scheduledAt,
          durationMinutes: effectiveDuration,
          bufferMinutes: buffer,
          existingDefaultDurationMinutes: defaultDuration,
          excludeId: appointmentId,
        });
        if (conflict) {
          throw new ValidationError("That time slot overlaps an existing appointment");
        }
        // A customer reschedule resets to pending re-confirmation; a team
        // reschedule keeps the current status.
        const [row] = await tx
          .update(businessAppointmentsTable)
          .set({
            scheduledAt,
            ...(durationMinutes !== undefined ? { durationMinutes } : {}),
            ...(isBizManager ? {} : { status: "pending" }),
          })
          .where(eq(businessAppointmentsTable.id, appointmentId))
          .returning();
        return row;
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    res.json({
      id: updated.id,
      businessId: updated.businessId,
      serviceId: updated.serviceId ?? null,
      serviceName: null,
      userId: updated.userId,
      userName: "",
      scheduledAt: updated.scheduledAt.toISOString(),
      durationMinutes: updated.durationMinutes ?? null,
      notes: updated.notes ?? null,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Business Messaging — restricted to owner/admin/support_agent
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/businesses/:handle/conversations",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const role = await getTeamRole(biz.id, user.id);
    if (!canAccessInbox(role) && user.role !== "admin") {
      res.status(403).json({ error: "Only owner/admin/support_agent can access the business inbox" });
      return;
    }

    const conversations = await db
      .select()
      .from(businessConversationsTable)
      .where(eq(businessConversationsTable.businessId, biz.id))
      .orderBy(desc(businessConversationsTable.lastMessageAt))
      .limit(100);

    if (conversations.length === 0) {
      res.json([]);
      return;
    }

    const userIds = [...new Set(conversations.map((c) => c.userId))];
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
      .from(usersTable)
      .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(userIds.map((id) => sql`${id}`), sql`, `)}]::int[])`);
    const userMap = new Map(users.map((u) => [u.id, u]));

    res.json(
      conversations.map((c) => {
        const u = userMap.get(c.userId);
        return {
          id: c.id,
          businessId: c.businessId,
          userId: c.userId,
          userName: u?.name ?? "Unknown",
          userPhotoUrl: u?.profilePhotoUrl ?? null,
          lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
          unreadByBusiness: c.unreadByBusiness,
          unreadByUser: c.unreadByUser,
          status: c.status,
          createdAt: c.createdAt.toISOString(),
        };
      }),
    );
  },
);

router.post(
  "/businesses/:handle/conversations",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const biz = await getBusinessByHandle(handle);

    if (!biz || !biz.isPublished || biz.status !== "active") {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    // Any authenticated user can open a conversation with the business
    const [existing] = await db
      .select()
      .from(businessConversationsTable)
      .where(
        and(
          eq(businessConversationsTable.businessId, biz.id),
          eq(businessConversationsTable.userId, user.id),
        ),
      );

    const conversation =
      existing ??
      (
        await db
          .insert(businessConversationsTable)
          .values({ businessId: biz.id, userId: user.id })
          .returning()
      )[0];

    const u = await getUserPublic(user.id);
    res.status(200).json({
      id: conversation.id,
      businessId: conversation.businessId,
      userId: conversation.userId,
      userName: u?.name ?? user.name,
      userPhotoUrl: u?.profilePhotoUrl ?? null,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      unreadByBusiness: conversation.unreadByBusiness,
      unreadByUser: conversation.unreadByUser,
      status: conversation.status,
      createdAt: conversation.createdAt.toISOString(),
    });
  },
);

router.get(
  "/businesses/:handle/conversations/:conversationId/messages",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const conversationId = parseId(req.params.conversationId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const [convo] = await db
      .select()
      .from(businessConversationsTable)
      .where(
        and(
          eq(businessConversationsTable.id, conversationId),
          eq(businessConversationsTable.businessId, biz.id),
        ),
      );

    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const role = await getTeamRole(biz.id, user.id);
    const isAdmin = user.role === "admin";

    // The user who owns the conversation, OR inbox-capable team members
    const isConvoOwner = convo.userId === user.id;
    const isInboxTeam = canAccessInbox(role) || isAdmin;
    if (!isConvoOwner && !isInboxTeam) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Mark as read for the appropriate side
    if (isInboxTeam && !isConvoOwner) {
      await db
        .update(businessConversationsTable)
        .set({ unreadByBusiness: 0 })
        .where(eq(businessConversationsTable.id, conversationId));
    } else if (isConvoOwner) {
      await db
        .update(businessConversationsTable)
        .set({ unreadByUser: 0 })
        .where(eq(businessConversationsTable.id, conversationId));
    }

    const messages = await db
      .select()
      .from(businessMessagesTable)
      .where(eq(businessMessagesTable.conversationId, conversationId))
      .orderBy(asc(businessMessagesTable.createdAt))
      .limit(200);

    if (messages.length === 0) {
      res.json([]);
      return;
    }

    const senderIds = [...new Set(messages.map((m) => m.senderUserId))];
    const senders = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(senderIds.map((id) => sql`${id}`), sql`, `)}]::int[])`);
    const senderMap = new Map(senders.map((s) => [s.id, s]));

    res.json(
      messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderUserId: m.senderUserId,
        senderName: senderMap.get(m.senderUserId)?.name ?? "Unknown",
        senderType: m.senderType,
        body: m.body,
        mediaUrl: m.mediaUrl ?? null,
        isRead: m.isRead,
        createdAt: m.createdAt.toISOString(),
      })),
    );
  },
);

router.post(
  "/businesses/:handle/conversations/:conversationId/messages",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const conversationId = parseId(req.params.conversationId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const [convo] = await db
      .select()
      .from(businessConversationsTable)
      .where(
        and(
          eq(businessConversationsTable.id, conversationId),
          eq(businessConversationsTable.businessId, biz.id),
        ),
      );

    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const role = await getTeamRole(biz.id, user.id);
    const isAdmin = user.role === "admin";
    const isConvoOwner = convo.userId === user.id;
    const isInboxTeam = canAccessInbox(role) || isAdmin;

    if (!isConvoOwner && !isInboxTeam) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      res.status(400).json({ error: "body is required" });
      return;
    }

    const senderType = isInboxTeam && !isConvoOwner ? "business" : "user";

    // POLICY: business-side (team) sends are business mutations, blocked while
    // the page is suspended/closed. Customer sends are always allowed so the
    // customer is never trapped mid-conversation.
    if (senderType === "business" && isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot send messages` });
      return;
    }

    const now = new Date();

    // Insert message + bump conversation counters atomically.
    const msg = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(businessMessagesTable)
        .values({ conversationId, senderUserId: user.id, senderType, body })
        .returning();
      if (senderType === "business") {
        await tx
          .update(businessConversationsTable)
          .set({
            lastMessageAt: now,
            unreadByUser: sql`${businessConversationsTable.unreadByUser} + 1`,
          })
          .where(eq(businessConversationsTable.id, conversationId));
      } else {
        await tx
          .update(businessConversationsTable)
          .set({
            lastMessageAt: now,
            unreadByBusiness: sql`${businessConversationsTable.unreadByBusiness} + 1`,
          })
          .where(eq(businessConversationsTable.id, conversationId));
      }
      return m;
    });

    if (senderType === "user") {
      void notifyBusinessTeam(biz.id, "new_message", "New message", `${user.name} sent you a message`, {
        relatedEntityId: conversationId,
        relatedEntityType: "conversation",
      });
    }

    res.status(201).json({
      id: msg.id,
      conversationId: msg.conversationId,
      senderUserId: msg.senderUserId,
      senderName: user.name,
      senderType: msg.senderType,
      body: msg.body,
      mediaUrl: msg.mediaUrl ?? null,
      isRead: msg.isRead,
      createdAt: msg.createdAt.toISOString(),
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Team Management (owner only for adds/removes; any team for list)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/businesses/:handle/team", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const role = await getTeamRole(biz.id, user.id);
  if (!isAnyTeamRole(role) && user.role !== "admin") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const team = await db
    .select()
    .from(businessPageRolesTable)
    .where(eq(businessPageRolesTable.businessId, biz.id))
    .orderBy(asc(businessPageRolesTable.createdAt));

  const userIds = team.map((t) => t.userId);
  const users =
    userIds.length > 0
      ? await db
          .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
          .from(usersTable)
          .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(userIds.map((id) => sql`${id}`), sql`, `)}]::int[])`)
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  res.json(
    team.map((t) => ({
      id: t.id,
      businessId: t.businessId,
      userId: t.userId,
      userName: userMap.get(t.userId)?.name ?? "Unknown",
      userPhotoUrl: userMap.get(t.userId)?.profilePhotoUrl ?? null,
      role: t.role,
      createdAt: t.createdAt.toISOString(),
    })),
  );
});

router.post("/businesses/:handle/team", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const myRole = await getTeamRole(biz.id, user.id);
  if (myRole !== "owner" && user.role !== "admin") {
    res.status(403).json({ error: "Only the business owner can manage team members" });
    return;
  }

  if (isWriteBlocked(biz, user.role === "admin")) {
    res.status(409).json({ error: `Business is ${biz.status}` });
    return;
  }

  const targetUserId = typeof req.body?.userId === "number" ? req.body.userId : null;
  const newRole = req.body?.role;

  if (!targetUserId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  if (!isValidAssignableRole(newRole)) {
    res.status(400).json({
      error: `role must be one of: ${ALL_ASSIGNABLE_ROLES.join(", ")}`,
    });
    return;
  }

  const [targetUser] = await db
    .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));
  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Preserve the owner row: never assign/overwrite the owner via this endpoint.
  // Reject if the target is the page owner OR already holds the owner role.
  if (targetUserId === biz.ownerUserId) {
    res.status(400).json({ error: "The business owner's role cannot be changed" });
    return;
  }
  const existingRole = await getTeamRole(biz.id, targetUserId);
  if (existingRole === "owner") {
    res.status(400).json({ error: "The business owner's role cannot be changed" });
    return;
  }

  // onConflictDoUpdate is scoped to non-owner rows only (owner is rejected above)
  // and the SET explicitly guards against writing role='owner' — the DB write
  // will only ever set an assignable role.
  const [member] = await db
    .insert(businessPageRolesTable)
    .values({ businessId: biz.id, userId: targetUserId, role: newRole })
    .onConflictDoUpdate({
      target: [businessPageRolesTable.businessId, businessPageRolesTable.userId],
      set: { role: newRole },
      // Defense in depth: never touch a row that is somehow the owner.
      setWhere: sql`${businessPageRolesTable.role} <> 'owner'`,
    })
    .returning();

  if (!member) {
    // setWhere blocked the update (row was owner) — should not happen given the
    // guard above, but fail safe.
    res.status(400).json({ error: "The business owner's role cannot be changed" });
    return;
  }

  res.status(201).json({
    id: member.id,
    businessId: member.businessId,
    userId: member.userId,
    userName: targetUser.name,
    userPhotoUrl: targetUser.profilePhotoUrl ?? null,
    role: member.role,
    createdAt: member.createdAt.toISOString(),
  });
});

router.delete(
  "/businesses/:handle/team/:userId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const targetUserId = parseId(req.params.userId);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const isAdmin = user.role === "admin";
    const myRole = await getTeamRole(biz.id, user.id);
    if (myRole !== "owner" && !isAdmin) {
      res.status(403).json({ error: "Only the business owner can remove team members" });
      return;
    }

    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }

    const [targetMember] = await db
      .select()
      .from(businessPageRolesTable)
      .where(
        and(
          eq(businessPageRolesTable.businessId, biz.id),
          eq(businessPageRolesTable.userId, targetUserId),
        ),
      );

    if (!targetMember) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }
    // Owner row is protected: refuse by role AND by owner-user identity.
    if (targetMember.role === "owner" || targetUserId === biz.ownerUserId) {
      res.status(400).json({ error: "Cannot remove the owner from the team" });
      return;
    }

    await db
      .delete(businessPageRolesTable)
      .where(
        and(
          eq(businessPageRolesTable.businessId, biz.id),
          eq(businessPageRolesTable.userId, targetUserId),
          // Defense in depth: never delete the owner row at the DB level.
          sql`${businessPageRolesTable.role} <> 'owner'`,
        ),
      );

    res.sendStatus(204);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard (owner/admin/analyst)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/businesses/:handle/dashboard", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const role = await getTeamRole(biz.id, user.id);
  if (!canReadManagement(role) && user.role !== "admin") {
    res.status(403).json({ error: "Only owner/admin/analyst can access the dashboard" });
    return;
  }

  const [serviceCountRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(businessServicesTable)
    .where(and(eq(businessServicesTable.businessId, biz.id), eq(businessServicesTable.isActive, true)));
  const [productCountRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(businessProductsTable)
    .where(
      and(eq(businessProductsTable.businessId, biz.id), eq(businessProductsTable.isAvailable, true)),
    );
  const [offerCountRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(businessOffersTable)
    .where(and(eq(businessOffersTable.businessId, biz.id), eq(businessOffersTable.isActive, true)));
  const [apptCountRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(businessAppointmentsTable)
    .where(eq(businessAppointmentsTable.businessId, biz.id));
  const [pendingApptRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(businessAppointmentsTable)
    .where(
      and(
        eq(businessAppointmentsTable.businessId, biz.id),
        eq(businessAppointmentsTable.status, "pending"),
      ),
    );
  const [unreadMsgsRow] = await db
    .select({ c: sql<number>`coalesce(sum(unread_by_business), 0)::int` })
    .from(businessConversationsTable)
    .where(eq(businessConversationsTable.businessId, biz.id));

  res.json({
    businessId: biz.id,
    followerCount: biz.followerCount,
    saveCount: biz.saveCount,
    reviewCount: biz.reviewCount,
    averageRating: biz.averageRating ?? null,
    checkInCount: biz.checkInCount,
    postCount: biz.postCount,
    serviceCount: serviceCountRow.c,
    productCount: productCountRow.c,
    offerCount: offerCountRow.c,
    appointmentCount: apptCountRow.c,
    pendingAppointments: pendingApptRow.c,
    unreadMessages: unreadMsgsRow.c,
    recentActivity: [],
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Insights (owner/admin/analyst)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/businesses/:handle/insights", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const handle = parseHandle(req.params.handle);
  const biz = await getBusinessByHandle(handle);

  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  const role = await getTeamRole(biz.id, user.id);
  if (!canReadManagement(role) && user.role !== "admin") {
    res.status(403).json({ error: "Only owner/admin/analyst can access insights" });
    return;
  }

  const days = 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const events = await db
    .select({
      eventType: businessInsightEventsTable.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(businessInsightEventsTable)
    .where(
      and(
        eq(businessInsightEventsTable.businessId, biz.id),
        sql`${businessInsightEventsTable.occurredAt} >= ${since}`,
      ),
    )
    .groupBy(businessInsightEventsTable.eventType);

  const eventMap = new Map(events.map((e) => [e.eventType, e.count]));

  res.json({
    businessId: biz.id,
    days,
    profileViews: eventMap.get("profile_view") ?? 0,
    newFollowers: eventMap.get("follow") ?? 0,
    newCheckIns: eventMap.get("checkin") ?? 0,
    newReviews: eventMap.get("review") ?? 0,
    eventBreakdown: events.map((e) => ({
      label: e.eventType.replace(/_/g, " "),
      eventType: e.eventType,
      count: e.count,
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Notifications (owner/admin/analyst)
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/businesses/:handle/notifications",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const role = await getTeamRole(biz.id, user.id);
    if (!canReadManagement(role) && user.role !== "admin") {
      res.status(403).json({ error: "Only owner/admin/analyst can access notifications" });
      return;
    }

    const notifications = await db
      .select()
      .from(businessNotificationsTable)
      .where(
        and(
          eq(businessNotificationsTable.businessId, biz.id),
          eq(businessNotificationsTable.recipientUserId, user.id),
        ),
      )
      .orderBy(desc(businessNotificationsTable.createdAt))
      .limit(50);

    res.json(
      notifications.map((n) => ({
        id: n.id,
        businessId: n.businessId,
        recipientUserId: n.recipientUserId,
        type: n.type,
        title: n.title,
        message: n.message,
        relatedEntityId: n.relatedEntityId ?? null,
        relatedEntityType: n.relatedEntityType ?? null,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin – list all businesses
// ─────────────────────────────────────────────────────────────────────────────

router.get("/admin/businesses", requireAuth("admin"), async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const status = typeof q.status === "string" ? q.status : undefined;
  const limit = Math.min(
    typeof q.limit === "string" ? parseInt(q.limit, 10) || 50 : 50,
    200,
  );
  const offset = typeof q.offset === "string" ? parseInt(q.offset, 10) || 0 : 0;

  const conditions = [];
  if (status) conditions.push(eq(businessesTable.status, status));

  // Verification status filter (unverified | pending | verified | rejected).
  if (q.verificationStatus) {
    conditions.push(eq(businessesTable.verificationStatus, q.verificationStatus));
  }
  // Category / type filters.
  if (q.category) conditions.push(eq(businessesTable.category, q.category));
  if (q.businessType) conditions.push(eq(businessesTable.businessType, q.businessType));

  // Text search over name + handle.
  if (q.q) {
    const term = `%${q.q.toLowerCase()}%`;
    conditions.push(
      sql`(lower(${businessesTable.name}) LIKE ${term} OR lower(${businessesTable.handle}) LIKE ${term})`,
    );
  }

  // Featured / sponsored honoring active windows (*Until in the future or null).
  if (q.featured === "true") {
    conditions.push(
      sql`(${businessesTable.isFeatured} = true AND (${businessesTable.featuredUntil} IS NULL OR ${businessesTable.featuredUntil} > now()))`,
    );
  } else if (q.featured === "false") {
    conditions.push(
      sql`NOT (${businessesTable.isFeatured} = true AND (${businessesTable.featuredUntil} IS NULL OR ${businessesTable.featuredUntil} > now()))`,
    );
  }
  if (q.sponsored === "true") {
    conditions.push(
      sql`(${businessesTable.isSponsored} = true AND (${businessesTable.sponsoredUntil} IS NULL OR ${businessesTable.sponsoredUntil} > now()))`,
    );
  } else if (q.sponsored === "false") {
    conditions.push(
      sql`NOT (${businessesTable.isSponsored} = true AND (${businessesTable.sponsoredUntil} IS NULL OR ${businessesTable.sponsoredUntil} > now()))`,
    );
  }

  // Appointments available: booking enabled + at least one active service.
  if (q.appointmentsAvailable === "true") {
    conditions.push(
      sql`(${businessesTable.bookingEnabled} = true AND EXISTS (SELECT 1 FROM business_services s WHERE s.business_id = ${businessesTable.id} AND s.is_active = true AND s.status = 'active'))`,
    );
  }

  // Content-availability filters (EXISTS subqueries, mirroring the directory).
  if (q.hasServices === "true") {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM business_services s WHERE s.business_id = ${businessesTable.id} AND s.is_active = true AND s.status = 'active')`,
    );
  }
  if (q.hasProducts === "true") {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM business_products p WHERE p.business_id = ${businessesTable.id} AND p.is_available = true AND p.status = 'active')`,
    );
  }
  if (q.hasOffers === "true") {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM business_offers o WHERE o.business_id = ${businessesTable.id} AND o.is_active = true AND (o.expires_at IS NULL OR o.expires_at > now()))`,
    );
  }
  if (q.hasEvents === "true") {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM business_events e WHERE e.business_id = ${businessesTable.id} AND e.status = 'active' AND e.visibility = 'public')`,
    );
  }

  // Reports pending: at least one open content report against this page.
  if (q.reportsPending === "true") {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM business_content_reports r WHERE r.business_id = ${businessesTable.id} AND r.status = 'open')`,
    );
  }

  const businesses = await db
    .select()
    .from(businessesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(businessesTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(businesses.map(serializeAdminBusinessSummary));
});

// ─────────────────────────────────────────────────────────────────────────────
// Business Media — Albums & Media Items (owner/admin/editor CRUD)
// Public sees only active items on active+published pages; team preview all.
// ─────────────────────────────────────────────────────────────────────────────

function serializeAlbum(a: typeof businessAlbumsTable.$inferSelect) {
  return {
    id: a.id,
    businessId: a.businessId,
    title: a.title,
    description: a.description ?? null,
    coverUrl: a.coverUrl ?? null,
    status: a.status,
    sortOrder: a.sortOrder,
    createdAt: a.createdAt.toISOString(),
  };
}

function serializeMediaItem(
  m: typeof businessMediaItemsTable.$inferSelect,
  viewerState?: ChildViewerState,
) {
  return {
    id: m.id,
    businessId: m.businessId,
    albumId: m.albumId ?? null,
    kind: m.kind,
    title: m.title ?? null,
    caption: m.caption ?? null,
    category: m.category ?? null,
    hashtags: m.hashtags ?? [],
    mediaUrl: m.mediaUrl,
    posterUrl: m.posterUrl ?? null,
    source: m.source,
    submittedByUserId: m.submittedByUserId ?? null,
    status: m.status,
    likeCount: m.likeCount,
    saveCount: m.saveCount,
    commentCount: m.commentCount,
    viewCount: m.viewCount,
    viewerLiked: viewerState?.liked ?? false,
    viewerSaved: viewerState?.saved ?? false,
    sortOrder: m.sortOrder,
    createdAt: m.createdAt.toISOString(),
  };
}

router.get("/businesses/:handle/albums", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const biz = await getBusinessByHandle(parseHandle(req.params.handle));
  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
  if (!allowed) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const conditions = [eq(businessAlbumsTable.businessId, biz.id)];
  if (!isManagementView) conditions.push(eq(businessAlbumsTable.status, "active"));
  const albums = await db
    .select()
    .from(businessAlbumsTable)
    .where(and(...conditions))
    .orderBy(asc(businessAlbumsTable.sortOrder), asc(businessAlbumsTable.createdAt));
  res.json(albums.map(serializeAlbum));
});

router.post("/businesses/:handle/albums", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const biz = await getBusinessByHandle(parseHandle(req.params.handle));
  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const isAdmin = user.role === "admin";
  const role = await getTeamRole(biz.id, user.id);
  if (!canEditContent(role) && !isAdmin) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }
  if (isWriteBlocked(biz, isAdmin)) {
    res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  let coverUrl: string | null = null;
  try {
    if (typeof body.coverUrl === "string" && body.coverUrl) {
      coverUrl = await finalizeUploadedImage(body.coverUrl, user.id);
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  const statusVal =
    typeof body.status === "string" && ["active", "hidden"].includes(body.status)
      ? body.status
      : undefined;

  const id = typeof body.id === "number" ? body.id : null;
  let album: typeof businessAlbumsTable.$inferSelect;
  if (id) {
    const [existing] = await db
      .select()
      .from(businessAlbumsTable)
      .where(and(eq(businessAlbumsTable.id, id), eq(businessAlbumsTable.businessId, biz.id)));
    if (!existing) {
      res.status(404).json({ error: "Album not found" });
      return;
    }
    [album] = await db
      .update(businessAlbumsTable)
      .set({
        title,
        description: typeof body.description === "string" ? body.description : existing.description,
        coverUrl: coverUrl || existing.coverUrl,
        status: statusVal ?? existing.status,
        sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : existing.sortOrder,
      })
      .where(eq(businessAlbumsTable.id, id))
      .returning();
  } else {
    [album] = await db
      .insert(businessAlbumsTable)
      .values({
        businessId: biz.id,
        title,
        description: typeof body.description === "string" ? body.description : null,
        coverUrl,
        status: statusVal ?? "active",
        sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
      })
      .returning();
  }
  res.status(200).json(serializeAlbum(album));
});

router.delete(
  "/businesses/:handle/albums/:albumId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canEditContent(role) && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }
    const albumId = parseId(req.params.albumId);
    await db.transaction(async (tx) => {
      // Detach media items from the album (keep them as ungrouped) then delete.
      await tx
        .update(businessMediaItemsTable)
        .set({ albumId: null })
        .where(
          and(
            eq(businessMediaItemsTable.albumId, albumId),
            eq(businessMediaItemsTable.businessId, biz.id),
          ),
        );
      await tx
        .delete(businessAlbumsTable)
        .where(and(eq(businessAlbumsTable.id, albumId), eq(businessAlbumsTable.businessId, biz.id)));
    });
    res.sendStatus(204);
  },
);

router.get("/businesses/:handle/media", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const biz = await getBusinessByHandle(parseHandle(req.params.handle));
  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
  if (!allowed) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const conditions = [eq(businessMediaItemsTable.businessId, biz.id)];
  if (!isManagementView) conditions.push(eq(businessMediaItemsTable.status, "active"));
  // Optional filters: albumId, kind
  const albumIdRaw = typeof req.query.albumId === "string" ? parseInt(req.query.albumId, 10) : NaN;
  if (!isNaN(albumIdRaw)) conditions.push(eq(businessMediaItemsTable.albumId, albumIdRaw));
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  if (kind && ["photo", "video", "reel"].includes(kind)) {
    conditions.push(eq(businessMediaItemsTable.kind, kind));
  }
  const items = await db
    .select()
    .from(businessMediaItemsTable)
    .where(and(...conditions))
    .orderBy(asc(businessMediaItemsTable.sortOrder), desc(businessMediaItemsTable.createdAt))
    .limit(200);
  const viewerStates = await loadChildViewerStates(
    viewer?.id,
    "media",
    items.map((i) => i.id),
  );
  res.json(items.map((i) => serializeMediaItem(i, viewerStates.get(i.id))));
});

router.post("/businesses/:handle/media", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const biz = await getBusinessByHandle(parseHandle(req.params.handle));
  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const isAdmin = user.role === "admin";
  const role = await getTeamRole(biz.id, user.id);
  if (!canEditContent(role) && !isAdmin) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }
  if (isWriteBlocked(biz, isAdmin)) {
    res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!["photo", "video", "reel"].includes(kind)) {
    res.status(400).json({ error: "kind must be one of: photo, video, reel" });
    return;
  }
  const rawMediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl : "";
  if (!rawMediaUrl) {
    res.status(400).json({ error: "mediaUrl is required" });
    return;
  }
  // Optional album must belong to the business.
  let albumId: number | null = null;
  if (typeof body.albumId === "number") {
    const [album] = await db
      .select({ id: businessAlbumsTable.id })
      .from(businessAlbumsTable)
      .where(and(eq(businessAlbumsTable.id, body.albumId), eq(businessAlbumsTable.businessId, biz.id)));
    if (!album) {
      res.status(400).json({ error: "albumId does not refer to an album of this business" });
      return;
    }
    albumId = album.id;
  }

  // Photo→image finalize; video/reel→video finalize+transcode (internal only).
  let mediaUrl: string;
  let posterUrl: string | null = null;
  try {
    const finalized = await finalizeInternalMedia(
      rawMediaUrl,
      kind === "photo" ? "image" : "video",
      user.id,
    );
    mediaUrl = finalized.url;
    posterUrl = finalized.posterUrl;
    // Allow an explicit poster override for video/reel (finalized image).
    if (kind !== "photo" && typeof body.posterUrl === "string" && body.posterUrl && !posterUrl) {
      if (!toObjectEntityPath(body.posterUrl)) {
        res.status(400).json({ error: "posterUrl must reference an uploaded storage object" });
        return;
      }
      posterUrl = await finalizeUploadedImage(body.posterUrl, user.id);
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const [item] = await db
    .insert(businessMediaItemsTable)
    .values({
      businessId: biz.id,
      albumId,
      kind,
      title: typeof body.title === "string" ? body.title : null,
      caption: typeof body.caption === "string" ? body.caption : null,
      mediaUrl,
      posterUrl,
      status: "active",
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
    })
    .returning();
  res.status(201).json(serializeMediaItem(item));
});

router.patch(
  "/businesses/:handle/media/:mediaId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canEditContent(role) && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }
    const mediaId = parseId(req.params.mediaId);
    const [existing] = await db
      .select()
      .from(businessMediaItemsTable)
      .where(
        and(eq(businessMediaItemsTable.id, mediaId), eq(businessMediaItemsTable.businessId, biz.id)),
      );
    if (!existing) {
      res.status(404).json({ error: "Media item not found" });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const statusVal =
      typeof body.status === "string" && ["active", "hidden"].includes(body.status)
        ? body.status
        : undefined;
    // Metadata-only update (title/caption/status/sortOrder/album). Media bytes
    // are immutable here — replacing bytes means creating a new item.
    let albumId = existing.albumId;
    if (body.albumId === null) albumId = null;
    else if (typeof body.albumId === "number") {
      const [album] = await db
        .select({ id: businessAlbumsTable.id })
        .from(businessAlbumsTable)
        .where(and(eq(businessAlbumsTable.id, body.albumId), eq(businessAlbumsTable.businessId, biz.id)));
      if (!album) {
        res.status(400).json({ error: "albumId does not refer to an album of this business" });
        return;
      }
      albumId = album.id;
    }
    const [updated] = await db
      .update(businessMediaItemsTable)
      .set({
        albumId,
        title: typeof body.title === "string" ? body.title : existing.title,
        caption: typeof body.caption === "string" ? body.caption : existing.caption,
        status: statusVal ?? existing.status,
        sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : existing.sortOrder,
      })
      .where(eq(businessMediaItemsTable.id, mediaId))
      .returning();
    res.json(serializeMediaItem(updated));
  },
);

router.delete(
  "/businesses/:handle/media/:mediaId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canEditContent(role) && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }
    const mediaId = parseId(req.params.mediaId);
    await db
      .delete(businessMediaItemsTable)
      .where(
        and(eq(businessMediaItemsTable.id, mediaId), eq(businessMediaItemsTable.businessId, biz.id)),
      );
    res.sendStatus(204);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Business Events & RSVPs
// ─────────────────────────────────────────────────────────────────────────────

function serializeEvent(
  e: typeof businessEventsTable.$inferSelect,
  viewerRsvp?: string | null,
  viewerState?: ChildViewerState,
) {
  return {
    id: e.id,
    businessId: e.businessId,
    title: e.title,
    description: e.description ?? null,
    location: e.location ?? null,
    onlineUrl: e.onlineUrl ?? null,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt?.toISOString() ?? null,
    imageUrls: e.imageUrls ?? [],
    ticketUrl: e.ticketUrl ?? null,
    status: e.status,
    visibility: e.visibility,
    rsvpCount: e.rsvpCount,
    likeCount: e.likeCount,
    saveCount: e.saveCount,
    commentCount: e.commentCount,
    feedPostId: e.feedPostId ?? null,
    viewerRsvp: viewerRsvp ?? null,
    viewerLiked: viewerState?.liked ?? false,
    viewerSaved: viewerState?.saved ?? false,
    createdAt: e.createdAt.toISOString(),
  };
}

router.get("/businesses/:handle/events", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const biz = await getBusinessByHandle(parseHandle(req.params.handle));
  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
  if (!allowed) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const conditions = [eq(businessEventsTable.businessId, biz.id)];
  if (!isManagementView) {
    // Public: active + public only (drafts, cancelled, removed, private hidden).
    conditions.push(eq(businessEventsTable.status, "active"));
    conditions.push(eq(businessEventsTable.visibility, "public"));
  } else {
    // Management preview: everything except removed.
    conditions.push(sql`${businessEventsTable.status} <> 'removed'`);
  }
  const events = await db
    .select()
    .from(businessEventsTable)
    .where(and(...conditions))
    .orderBy(asc(businessEventsTable.startsAt))
    .limit(100);

  // Viewer RSVP states.
  const rsvpMap = new Map<number, string>();
  if (viewer?.id && events.length > 0) {
    const eventIds = events.map((e) => e.id);
    const rsvps = await db
      .select({ eventId: businessEventRsvpsTable.eventId, status: businessEventRsvpsTable.status })
      .from(businessEventRsvpsTable)
      .where(
        and(
          eq(businessEventRsvpsTable.userId, viewer.id),
          sql`${businessEventRsvpsTable.eventId} = ANY(ARRAY[${sql.join(eventIds.map((id) => sql`${id}`), sql`, `)}]::int[])`,
        ),
      );
    rsvps.forEach((r) => rsvpMap.set(r.eventId, r.status));
  }
  const viewerStates = await loadChildViewerStates(
    viewer?.id,
    "event",
    events.map((e) => e.id),
  );
  res.json(
    events.map((e) => serializeEvent(e, rsvpMap.get(e.id) ?? null, viewerStates.get(e.id))),
  );
});

router.post("/businesses/:handle/events", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const biz = await getBusinessByHandle(parseHandle(req.params.handle));
  if (!biz) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const isAdmin = user.role === "admin";
  const role = await getTeamRole(biz.id, user.id);
  if (!canEditContent(role) && !isAdmin) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }
  if (isWriteBlocked(biz, isAdmin)) {
    res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const startsAtRaw = typeof body.startsAt === "string" ? body.startsAt : "";
  const startsAt = new Date(startsAtRaw);
  if (!startsAtRaw || isNaN(startsAt.getTime())) {
    res.status(400).json({ error: "startsAt is required and must be a valid date" });
    return;
  }
  let endsAt: Date | null = null;
  if (typeof body.endsAt === "string" && body.endsAt) {
    endsAt = new Date(body.endsAt);
    if (isNaN(endsAt.getTime())) {
      res.status(400).json({ error: "endsAt is not a valid date" });
      return;
    }
  }

  let ticketUrl: string | null;
  try {
    ticketUrl = validateHttpUrl(body.ticketUrl, "ticketUrl");
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  // Event images: finalized internal storage images only.
  let imageUrls: string[] = [];
  try {
    if (Array.isArray(body.imageUrls)) {
      for (const u of body.imageUrls as unknown[]) {
        if (typeof u === "string" && u) imageUrls.push(await finalizeUploadedImage(u, user.id));
      }
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const statusVal =
    typeof body.status === "string" && ["draft", "active", "cancelled"].includes(body.status)
      ? body.status
      : "active";
  const visibility = body.visibility === "private" ? "private" : "public";

  const id = typeof body.id === "number" ? body.id : null;
  let event: typeof businessEventsTable.$inferSelect;
  if (id) {
    const [existing] = await db
      .select()
      .from(businessEventsTable)
      .where(and(eq(businessEventsTable.id, id), eq(businessEventsTable.businessId, biz.id)));
    if (!existing) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    [event] = await db
      .update(businessEventsTable)
      .set({
        title,
        description: typeof body.description === "string" ? body.description : existing.description,
        location: typeof body.location === "string" ? body.location : existing.location,
        startsAt,
        endsAt,
        imageUrls: Array.isArray(body.imageUrls) ? imageUrls : existing.imageUrls,
        ticketUrl: body.ticketUrl !== undefined ? ticketUrl : existing.ticketUrl,
        status: statusVal,
        visibility,
      })
      .where(eq(businessEventsTable.id, id))
      .returning();
  } else {
    [event] = await db
      .insert(businessEventsTable)
      .values({
        businessId: biz.id,
        title,
        description: typeof body.description === "string" ? body.description : null,
        location: typeof body.location === "string" ? body.location : null,
        startsAt,
        endsAt,
        imageUrls,
        ticketUrl,
        status: statusVal,
        visibility,
      })
      .returning();
  }
  res.status(200).json(serializeEvent(event, null));
});

router.delete(
  "/businesses/:handle/events/:eventId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canEditContent(role) && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }
    const eventId = parseId(req.params.eventId);
    // Soft-remove (terminal) so RSVP history is retained.
    const [updated] = await db
      .update(businessEventsTable)
      .set({ status: "removed" })
      .where(and(eq(businessEventsTable.id, eventId), eq(businessEventsTable.businessId, biz.id)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.sendStatus(204);
  },
);

// RSVP toggle — going|interested; idempotent; transactional rsvpCount.
router.post(
  "/businesses/:handle/events/:eventId/rsvp",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const viewer = user;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
    if (!allowed) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const eventId = parseId(req.params.eventId);
    const [event] = await db
      .select()
      .from(businessEventsTable)
      .where(and(eq(businessEventsTable.id, eventId), eq(businessEventsTable.businessId, biz.id)));
    // Public may only RSVP to active+public events; team preview may see others.
    if (
      !event ||
      event.status === "removed" ||
      (!isManagementView && (event.status !== "active" || event.visibility !== "public"))
    ) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    if (event.status === "cancelled") {
      res.status(409).json({ error: "Cannot RSVP to a cancelled event" });
      return;
    }

    const desired = req.body?.status === "interested" ? "interested" : "going";

    const { active, rsvpStatus, rsvpCount } = await db.transaction(async (tx) => {
      // Try to create the RSVP; a returned row means a NEW RSVP → increment.
      const insertedRsvp = await tx
        .insert(businessEventRsvpsTable)
        .values({ eventId, userId: user.id, status: desired })
        .onConflictDoNothing()
        .returning({ id: businessEventRsvpsTable.id });

      if (insertedRsvp.length > 0) {
        const [row] = await tx
          .update(businessEventsTable)
          .set({ rsvpCount: sql`${businessEventsTable.rsvpCount} + 1` })
          .where(eq(businessEventsTable.id, eventId))
          .returning({ rsvpCount: businessEventsTable.rsvpCount });
        return { active: true, rsvpStatus: desired, rsvpCount: row.rsvpCount };
      }

      // Row already exists. Toggle off if same desired status; else switch.
      // DELETE ... RETURNING with a status predicate confirms the toggle-off
      // actually removed a row before decrementing.
      const deleted = await tx
        .delete(businessEventRsvpsTable)
        .where(
          and(
            eq(businessEventRsvpsTable.eventId, eventId),
            eq(businessEventRsvpsTable.userId, user.id),
            eq(businessEventRsvpsTable.status, desired),
          ),
        )
        .returning({ id: businessEventRsvpsTable.id });
      if (deleted.length > 0) {
        const [row] = await tx
          .update(businessEventsTable)
          .set({ rsvpCount: sql`greatest(${businessEventsTable.rsvpCount} - 1, 0)` })
          .where(eq(businessEventsTable.id, eventId))
          .returning({ rsvpCount: businessEventsTable.rsvpCount });
        return { active: false, rsvpStatus: null as string | null, rsvpCount: row.rsvpCount };
      }

      // Different status → switch in place (no count change).
      await tx
        .update(businessEventRsvpsTable)
        .set({ status: desired })
        .where(
          and(
            eq(businessEventRsvpsTable.eventId, eventId),
            eq(businessEventRsvpsTable.userId, user.id),
          ),
        );
      const [cur] = await tx
        .select({ rsvpCount: businessEventsTable.rsvpCount })
        .from(businessEventsTable)
        .where(eq(businessEventsTable.id, eventId));
      return { active: true, rsvpStatus: desired, rsvpCount: cur?.rsvpCount ?? 0 };
    });

    res.json({ active, rsvpStatus, rsvpCount });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Verification submissions
//   Owner submits; team/admin read; admin reviews. Documents are NEVER exposed
//   publicly and only presence (count) is shown to the owner/team.
// ─────────────────────────────────────────────────────────────────────────────

function serializeVerification(
  v: typeof businessVerificationSubmissionsTable.$inferSelect,
  includeDocs: boolean,
) {
  const docs = v.documentUrls ?? [];
  return {
    id: v.id,
    businessId: v.businessId,
    legalName: v.legalName ?? null,
    contactEmail: v.contactEmail ?? null,
    contactPhone: v.contactPhone ?? null,
    notes: v.notes ?? null,
    // Never expose raw storage paths, even to admin. Admin gets opaque
    // per-document download refs (index-addressed, admin-authorized route);
    // everyone else gets only the count.
    documentCount: docs.length,
    documents: includeDocs
      ? docs.map((_ref, i) => ({
          index: i,
          downloadUrl: `/api/admin/businesses/verification/${v.id}/documents/${i}`,
        }))
      : undefined,
    status: v.status,
    reviewNotes: v.reviewNotes ?? null,
    reviewedAt: v.reviewedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

router.get(
  "/businesses/:handle/verification",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canManageSettings(role) && !isAdmin) {
      res.status(403).json({ error: "Only owner/admin can view verification status" });
      return;
    }
    const rows = await db
      .select()
      .from(businessVerificationSubmissionsTable)
      .where(eq(businessVerificationSubmissionsTable.businessId, biz.id))
      .orderBy(desc(businessVerificationSubmissionsTable.createdAt));
    // Only platform admin sees raw document references.
    res.json({
      verificationStatus: biz.verificationStatus,
      submissions: rows.map((v) => serializeVerification(v, isAdmin)),
    });
  },
);

/**
 * POST /businesses/:handle/verification/documents
 *
 * Owner-only PRIVATE verification-document upload. The raw request body (bounded
 * to MAX_DOCUMENT_SIZE_BYTES by the body parser) is sniffed for a real
 * PDF/JPEG/PNG/WebP signature and written directly to an owner/business-scoped
 * key in the private object dir with a PRIVATE ACL (never public). Returns an
 * opaque documentRef ("/objects/verification/...") to be submitted below.
 */
router.post(
  "/businesses/:handle/verification/documents",
  requireAuth(),
  express.raw({ type: () => true, limit: MAX_DOCUMENT_SIZE_BYTES }),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const role = await getTeamRole(biz.id, user.id);
    const isAdmin = user.role === "admin";
    if (role !== "owner" && !isAdmin) {
      res.status(403).json({ error: "Only the business owner can upload verification documents" });
      return;
    }
    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "Request body must be the raw document bytes." });
      return;
    }
    try {
      const { objectPath, contentType } = await uploadVerificationDocumentBuffer(
        body,
        user.id,
        biz.id,
      );
      // Return an opaque ref; never a public serving URL.
      res.status(201).json({ documentRef: objectPath, contentType });
    } catch (err) {
      if (err instanceof InvalidUploadError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

router.post(
  "/businesses/:handle/verification",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    // Owner-only submission (platform admin may also submit on behalf).
    const role = await getTeamRole(biz.id, user.id);
    const isAdmin = user.role === "admin";
    if (role !== "owner" && !isAdmin) {
      res.status(403).json({ error: "Only the business owner can submit verification" });
      return;
    }
    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }
    // Reject if an active submission is already pending review.
    const [pending] = await db
      .select({ id: businessVerificationSubmissionsTable.id })
      .from(businessVerificationSubmissionsTable)
      .where(
        and(
          eq(businessVerificationSubmissionsTable.businessId, biz.id),
          eq(businessVerificationSubmissionsTable.status, "pending"),
        ),
      );
    if (pending) {
      res.status(409).json({ error: "A verification submission is already pending review" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    // Documents are opaque PRIVATE object refs produced by the upload route
    // above. Each is re-validated against the ACTUAL stored object: it must be
    // an /objects/ path (never an external/public URL), exist, be owned by the
    // SUBMITTING user, be PRIVATE (public-ACL objects are rejected outright),
    // and be a valid document type. The stored ref is NEVER promoted to public.
    // `documentRefs` is the new field; `documentUrls` is accepted as a legacy
    // alias for the same opaque-ref semantics.
    const documentUrls: string[] = [];
    const rawInput = Array.isArray(body.documentRefs)
      ? (body.documentRefs as unknown[])
      : Array.isArray(body.documentUrls)
        ? (body.documentUrls as unknown[])
        : [];
    for (const d of rawInput) {
      if (typeof d !== "string" || !d) continue;
      try {
        const ref = await assertPrivateVerificationDocument(d, user.id);
        documentUrls.push(ref);
      } catch (err) {
        if (err instanceof InvalidUploadError) {
          res.status(400).json({
            error: `verification document rejected: ${err.message}`,
          });
          return;
        }
        throw err;
      }
    }
    if (documentUrls.length === 0) {
      res.status(400).json({ error: "At least one document is required" });
      return;
    }

    const submission = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(businessVerificationSubmissionsTable)
        .values({
          businessId: biz.id,
          submittedByUserId: user.id,
          legalName: typeof body.legalName === "string" ? body.legalName : null,
          contactEmail: typeof body.contactEmail === "string" ? body.contactEmail : null,
          contactPhone: typeof body.contactPhone === "string" ? body.contactPhone : null,
          notes: typeof body.notes === "string" ? body.notes : null,
          documentUrls,
          status: "pending",
        })
        .returning();
      await tx
        .update(businessesTable)
        .set({ verificationStatus: "pending" })
        .where(eq(businessesTable.id, biz.id));
      return row;
    });

    // Owner sees no raw doc URLs back (only count).
    res.status(201).json(serializeVerification(submission, false));
  },
);

/**
 * GET /admin/businesses/verification/:submissionId/documents/:index
 *
 * Platform-admin-only proxy download of a PRIVATE verification document. The
 * raw storage path is never exposed; the admin addresses the document by
 * submission id + index. The object is streamed by the server (which is the
 * document's ACL owner-context bypass — admin authorization is enforced at the
 * route, not via a public ACL). Range requests are forwarded.
 */
router.get(
  "/admin/businesses/verification/:submissionId/documents/:index",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const submissionId = parseId(req.params.submissionId);
    const index = parseId(req.params.index);
    const [submission] = await db
      .select()
      .from(businessVerificationSubmissionsTable)
      .where(eq(businessVerificationSubmissionsTable.id, submissionId));
    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    const docs = submission.documentUrls ?? [];
    if (index < 0 || index >= docs.length) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const ref = docs[index];
    const objectPath = toObjectEntityPath(ref) ?? (ref.startsWith("/objects/") ? ref : null);
    if (!objectPath) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const service = new ObjectStorageService();
    try {
      const file = await service.getObjectEntityFile(objectPath);
      const response = await service.downloadObject(file, 0, req.headers.range);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Private documents must never be cached by shared caches.
      res.setHeader("Cache-Control", "private, no-store");
      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      throw err;
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin – moderation (platform admin only — bypasses lifecycle blocks)
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/admin/businesses/:handle/moderate",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const handle = parseHandle(req.params.handle);
    const biz = await getBusinessByHandle(handle);

    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const action = typeof req.body?.action === "string" ? req.body.action : null;
    const ALLOWED_ACTIONS = [
      "suspend",
      "reinstate",
      "remove_review",
      "restore_review",
      "hide_post",
      "restore_post",
      "warn",
      "badge_grant",
      "badge_revoke",
      "feature",
      "unfeature",
      "sponsor",
      "unsponsor",
      "verify",
      "reject_verification",
      "request_verification_changes",
      "set_category",
      "transfer_owner",
      "spotlight_enable",
      "spotlight_disable",
    ];
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
      res.status(400).json({ error: `action must be one of: ${ALLOWED_ACTIONS.join(", ")}` });
      return;
    }

    const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
    const targetEntityType =
      typeof req.body?.targetEntityType === "string" ? req.body.targetEntityType : null;
    const targetEntityId =
      typeof req.body?.targetEntityId === "number" ? req.body.targetEntityId : null;

    let updated = biz;

    if (action === "suspend") {
      [updated] = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(businessesTable)
          .set({ status: "suspended" })
          .where(eq(businessesTable.id, biz.id))
          .returning();
        // Hide linked feed rows in lockstep with the suspension.
        await hideBusinessFeedRows(tx, biz.id);
        return [row];
      });
    } else if (action === "reinstate") {
      [updated] = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(businessesTable)
          .set({ status: "active" })
          .where(eq(businessesTable.id, biz.id))
          .returning();
        // Restore feed rows only if the page is also published AND each source
        // content item is itself active + moderation-unlocked.
        if (row.isPublished) {
          await restoreBusinessFeedRows(tx, biz.id);
        }
        return [row];
      });
    } else if (action === "remove_review" && targetEntityId) {
      // Admin removal is terminal + moderation-locked so the team cannot alter it.
      await db.transaction(async (tx) => {
        await tx
          .update(businessReviewsTable)
          .set({ status: "removed", moderationLocked: true })
          .where(
            and(
              eq(businessReviewsTable.id, targetEntityId),
              eq(businessReviewsTable.businessId, biz.id),
            ),
          );
        await tx
          .update(businessesTable)
          .set({
            reviewCount: sql`(
              SELECT count(*)::int FROM business_reviews
              WHERE business_id = ${biz.id} AND status = 'active'
            )`,
            averageRating: sql`(
              SELECT AVG(rating)::numeric(3,2) FROM business_reviews
              WHERE business_id = ${biz.id} AND status = 'active'
            )`,
          })
          .where(eq(businessesTable.id, biz.id));
      });
    } else if (action === "restore_review" && targetEntityId) {
      // Only an admin can restore an admin-removed review; clears the lock.
      await db.transaction(async (tx) => {
        await tx
          .update(businessReviewsTable)
          .set({ status: "active", moderationLocked: false })
          .where(
            and(
              eq(businessReviewsTable.id, targetEntityId),
              eq(businessReviewsTable.businessId, biz.id),
            ),
          );
        await tx
          .update(businessesTable)
          .set({
            reviewCount: sql`(
              SELECT count(*)::int FROM business_reviews
              WHERE business_id = ${biz.id} AND status = 'active'
            )`,
            averageRating: sql`(
              SELECT AVG(rating)::numeric(3,2) FROM business_reviews
              WHERE business_id = ${biz.id} AND status = 'active'
            )`,
          })
          .where(eq(businessesTable.id, biz.id));
      });
    } else if (action === "hide_post" && targetEntityId) {
      // Admin hide sets moderationLocked so team cannot un-hide (terminal until
      // an admin restore_post clears it). Decrement postCount if it was active.
      await db.transaction(async (tx) => {
        // Conditional flip from active → hidden; RETURNING confirms the change
        // and yields the linked feed item so it can be hidden transactionally.
        const flippedActive = await tx
          .update(businessPostsTable)
          .set({ status: "hidden", moderationLocked: true })
          .where(
            and(
              eq(businessPostsTable.id, targetEntityId),
              eq(businessPostsTable.businessId, biz.id),
              eq(businessPostsTable.status, "active"),
            ),
          )
          .returning({ id: businessPostsTable.id, feedPostId: businessPostsTable.feedPostId });
        let feedPostId: number | null = null;
        if (flippedActive.length > 0) {
          feedPostId = flippedActive[0].feedPostId;
          await tx
            .update(businessesTable)
            .set({ postCount: sql`greatest(${businessesTable.postCount} - 1, 0)` })
            .where(eq(businessesTable.id, biz.id));
        } else {
          // Already hidden (or missing) — still stamp the lock without decrement.
          const locked = await tx
            .update(businessPostsTable)
            .set({ status: "hidden", moderationLocked: true })
            .where(
              and(
                eq(businessPostsTable.id, targetEntityId),
                eq(businessPostsTable.businessId, biz.id),
                sql`${businessPostsTable.status} <> 'removed'`,
              ),
            )
            .returning({ feedPostId: businessPostsTable.feedPostId });
          if (locked.length > 0) feedPostId = locked[0].feedPostId;
        }
        if (feedPostId != null) {
          await tx
            .update(feedPostsTable)
            .set({ status: "removed" })
            .where(eq(feedPostsTable.id, feedPostId));
        }
      });
    } else if (action === "restore_post" && targetEntityId) {
      // Only an admin can restore an admin-hidden post; clears the lock and
      // re-increments postCount when moving back to active.
      await db.transaction(async (tx) => {
        const [prev] = await tx
          .select({ status: businessPostsTable.status })
          .from(businessPostsTable)
          .where(
            and(
              eq(businessPostsTable.id, targetEntityId),
              eq(businessPostsTable.businessId, biz.id),
            ),
          );
        if (!prev) return;
        const restored = await tx
          .update(businessPostsTable)
          .set({ status: "active", moderationLocked: false })
          .where(
            and(
              eq(businessPostsTable.id, targetEntityId),
              eq(businessPostsTable.businessId, biz.id),
            ),
          )
          .returning({ feedPostId: businessPostsTable.feedPostId });
        if (prev.status !== "active") {
          await tx
            .update(businessesTable)
            .set({ postCount: sql`${businessesTable.postCount} + 1` })
            .where(eq(businessesTable.id, biz.id));
        }
        // Re-surface the linked canonical feed item.
        if (restored.length > 0 && restored[0].feedPostId != null) {
          await tx
            .update(feedPostsTable)
            .set({ status: "active" })
            .where(eq(feedPostsTable.id, restored[0].feedPostId));
        }
      });
    } else if (action === "badge_grant" && typeof req.body?.badge === "string") {
      const badge = req.body.badge as string;
      const currentBadges = updated.badges ?? [];
      if (!currentBadges.includes(badge)) {
        [updated] = await db
          .update(businessesTable)
          .set({ badges: [...currentBadges, badge] })
          .where(eq(businessesTable.id, biz.id))
          .returning();
      }
    } else if (action === "badge_revoke" && typeof req.body?.badge === "string") {
      const badge = req.body.badge as string;
      const currentBadges = (updated.badges ?? []).filter((b) => b !== badge);
      [updated] = await db
        .update(businessesTable)
        .set({ badges: currentBadges })
        .where(eq(businessesTable.id, biz.id))
        .returning();
    } else if (action === "feature") {
      const until =
        typeof req.body?.featuredUntil === "string" ? new Date(req.body.featuredUntil) : null;
      [updated] = await db
        .update(businessesTable)
        .set({ isFeatured: true, featuredUntil: until && !isNaN(until.getTime()) ? until : null })
        .where(eq(businessesTable.id, biz.id))
        .returning();
    } else if (action === "unfeature") {
      [updated] = await db
        .update(businessesTable)
        .set({ isFeatured: false, featuredUntil: null })
        .where(eq(businessesTable.id, biz.id))
        .returning();
    } else if (action === "sponsor") {
      const until =
        typeof req.body?.sponsoredUntil === "string" ? new Date(req.body.sponsoredUntil) : null;
      [updated] = await db
        .update(businessesTable)
        .set({ isSponsored: true, sponsoredUntil: until && !isNaN(until.getTime()) ? until : null })
        .where(eq(businessesTable.id, biz.id))
        .returning();
    } else if (action === "unsponsor") {
      [updated] = await db
        .update(businessesTable)
        .set({ isSponsored: false, sponsoredUntil: null })
        .where(eq(businessesTable.id, biz.id))
        .returning();
    } else if (action === "verify") {
      // Approve the latest pending submission (if any) + mark page verified.
      await db.transaction(async (tx) => {
        await tx
          .update(businessVerificationSubmissionsTable)
          .set({ status: "approved", reviewNotes: reason, reviewedByUserId: user.id, reviewedAt: new Date() })
          .where(
            and(
              eq(businessVerificationSubmissionsTable.businessId, biz.id),
              eq(businessVerificationSubmissionsTable.status, "pending"),
            ),
          );
        [updated] = await tx
          .update(businessesTable)
          .set({ verificationStatus: "verified" })
          .where(eq(businessesTable.id, biz.id))
          .returning();
      });
    } else if (action === "reject_verification") {
      await db.transaction(async (tx) => {
        await tx
          .update(businessVerificationSubmissionsTable)
          .set({ status: "rejected", reviewNotes: reason, reviewedByUserId: user.id, reviewedAt: new Date() })
          .where(
            and(
              eq(businessVerificationSubmissionsTable.businessId, biz.id),
              eq(businessVerificationSubmissionsTable.status, "pending"),
            ),
          );
        [updated] = await tx
          .update(businessesTable)
          .set({ verificationStatus: "rejected" })
          .where(eq(businessesTable.id, biz.id))
          .returning();
      });
    } else if (action === "request_verification_changes") {
      await db.transaction(async (tx) => {
        await tx
          .update(businessVerificationSubmissionsTable)
          .set({
            status: "changes_requested",
            reviewNotes: reason,
            reviewedByUserId: user.id,
            reviewedAt: new Date(),
          })
          .where(
            and(
              eq(businessVerificationSubmissionsTable.businessId, biz.id),
              eq(businessVerificationSubmissionsTable.status, "pending"),
            ),
          );
        [updated] = await tx
          .update(businessesTable)
          .set({ verificationStatus: "unverified" })
          .where(eq(businessesTable.id, biz.id))
          .returning();
      });
    } else if (action === "set_category" && typeof req.body?.category === "string") {
      [updated] = await db
        .update(businessesTable)
        .set({ category: req.body.category })
        .where(eq(businessesTable.id, biz.id))
        .returning();
    } else if (action === "spotlight_enable" || action === "spotlight_disable") {
      // Toggle the Local Lounge Spotlight eligibility flag. Disabling must not
      // leak stale picks: invalidate affected durable daily caches so a disabled
      // page drops out immediately. Never log coordinates or the location key.
      const enable = action === "spotlight_enable";
      [updated] = await db
        .update(businessesTable)
        .set({ eligibleForLoungeSpotlight: enable })
        .where(eq(businessesTable.id, biz.id))
        .returning();
      await invalidateDailyCachesForBusiness(biz.id);
    } else if (action === "transfer_owner" && typeof req.body?.newOwnerUserId === "number") {
      const newOwnerUserId = req.body.newOwnerUserId as number;
      const newOwner = await getUserPublic(newOwnerUserId);
      if (!newOwner) {
        res.status(400).json({ error: "newOwnerUserId does not refer to an existing user" });
        return;
      }
      // Owner-transfer target must satisfy the same personal-profile prerequisite
      // as page creation.
      if (!(await userHasPersonalProfile(newOwnerUserId))) {
        res.status(400).json({
          error: "The new owner must have a personal profile before ownership can be transferred.",
        });
        return;
      }
      await db.transaction(async (tx) => {
        // Point the business ownerUserId at the new owner and ensure a matching
        // owner team-member row exists (demote any prior owner rows to editor).
        [updated] = await tx
          .update(businessesTable)
          .set({ ownerUserId: newOwnerUserId })
          .where(eq(businessesTable.id, biz.id))
          .returning();
        await tx
          .update(businessPageRolesTable)
          .set({ role: "editor" })
          .where(
            and(
              eq(businessPageRolesTable.businessId, biz.id),
              eq(businessPageRolesTable.role, "owner"),
            ),
          );
        // Upsert the new owner's team row as owner.
        const [existingRow] = await tx
          .select({ id: businessPageRolesTable.id })
          .from(businessPageRolesTable)
          .where(
            and(
              eq(businessPageRolesTable.businessId, biz.id),
              eq(businessPageRolesTable.userId, newOwnerUserId),
            ),
          );
        if (existingRow) {
          await tx
            .update(businessPageRolesTable)
            .set({ role: "owner" })
            .where(eq(businessPageRolesTable.id, existingRow.id));
        } else {
          await tx
            .insert(businessPageRolesTable)
            .values({ businessId: biz.id, userId: newOwnerUserId, role: "owner" });
        }
      });
    }

    await db.insert(businessModerationLogsTable).values({
      businessId: biz.id,
      actorUserId: user.id,
      action,
      targetEntityType,
      targetEntityId,
      reason,
    });

    // Re-fetch to get fresh counts after potential review updates
    const [fresh] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, biz.id));

    res.json(await serializeBusinessDetail(fresh ?? updated, user.id));
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Unified child engagement — like / save / report for public business child
// entities (media | event | product | offer | checkin). Uses
// businessEngagementsTable (unique per entity/user/kind) with transactional,
// RETURNING-confirmed counter maintenance on the target row.
// ─────────────────────────────────────────────────────────────────────────────

type ChildEntityType = "media" | "event" | "product" | "offer" | "checkin";
const CHILD_ENTITY_TYPES = new Set<ChildEntityType>([
  "media",
  "event",
  "product",
  "offer",
  "checkin",
]);

// Which counter column each entity/kind maintains ("" = no counter tracked).
const CHILD_COUNTER_COLUMN: Record<ChildEntityType, { like: string; save: string }> = {
  media: { like: "like_count", save: "save_count" },
  event: { like: "like_count", save: "save_count" },
  product: { like: "like_count", save: "save_count" },
  offer: { like: "like_count", save: "save_count" },
  checkin: { like: "like_count", save: "" },
};
const CHILD_TABLE: Record<ChildEntityType, string> = {
  media: "business_media_items",
  event: "business_events",
  product: "business_products",
  offer: "business_offers",
  checkin: "business_check_ins",
};

/**
 * Loads a child entity row (id only) after asserting it exists, belongs to the
 * business, and — for non-management viewers — is publicly visible per the
 * existing visibility rules. Returns { ok } or writes a 404.
 */
async function loadEngageableChild(
  biz: typeof businessesTable.$inferSelect,
  entityType: ChildEntityType,
  entityId: number,
  isManagementView: boolean,
): Promise<boolean> {
  const table = CHILD_TABLE[entityType];
  // Public-visibility predicate per entity type.
  let visClause = sql`TRUE`;
  if (!isManagementView) {
    if (entityType === "media") visClause = sql`status = 'active'`;
    else if (entityType === "event") visClause = sql`status = 'active' AND visibility = 'public'`;
    else if (entityType === "product") visClause = sql`status = 'active' AND is_available = true`;
    else if (entityType === "offer")
      visClause = sql`is_active = true AND (expires_at IS NULL OR expires_at > now()) AND (starts_at IS NULL OR starts_at <= now())`;
    else if (entityType === "checkin") visClause = sql`visibility = 'public'`;
  } else {
    // Even team/admin cannot engage moderation-removed content; hidden/pending
    // remain engageable in the management preview. Offers/check-ins have no
    // 'removed' status column.
    if (entityType === "media" || entityType === "event" || entityType === "product")
      visClause = sql`status <> 'removed'`;
  }
  const result = await db.execute(
    sql`SELECT id FROM ${sql.raw(table)} WHERE id = ${entityId} AND business_id = ${biz.id} AND ${visClause} LIMIT 1`,
  );
  return (result.rows?.length ?? 0) > 0;
}

async function bumpChildCounter(
  tx: DbTx,
  entityType: ChildEntityType,
  entityId: number,
  kind: "like" | "save",
  delta: 1 | -1,
): Promise<void> {
  const col = CHILD_COUNTER_COLUMN[entityType][kind];
  if (!col) return;
  const table = CHILD_TABLE[entityType];
  const expr =
    delta === 1
      ? sql.raw(`${col} = ${col} + 1`)
      : sql.raw(`${col} = greatest(${col} - 1, 0)`);
  await tx.execute(
    sql`UPDATE ${sql.raw(table)} SET ${expr} WHERE id = ${entityId}`,
  );
}

function engagementHandler(kind: "like" | "save") {
  return async (req: import("express").Request, res: import("express").Response): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const entityType = parseHandle(req.params.entityType) as ChildEntityType;
    if (!CHILD_ENTITY_TYPES.has(entityType)) {
      res.status(404).json({ error: "Unknown entity type" });
      return;
    }
    const { allowed, isManagementView } = await resolveChildReadAccess(biz, user);
    if (!allowed) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const entityId = parseId(req.params.entityId);
    const exists = await loadEngageableChild(biz, entityType, entityId, isManagementView);
    if (!exists) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const active = await db.transaction(async (tx) => {
      // Confirm the row change via INSERT ... RETURNING; DELETE ... RETURNING to
      // toggle off. Counter change strictly follows the confirmed mutation.
      const inserted = await tx
        .insert(businessEngagementsTable)
        .values({ businessId: biz.id, entityType, entityId, userId: user.id, kind })
        .onConflictDoNothing()
        .returning({ id: businessEngagementsTable.id });
      if (inserted.length > 0) {
        await bumpChildCounter(tx, entityType, entityId, kind, 1);
        return true;
      }
      const deleted = await tx
        .delete(businessEngagementsTable)
        .where(
          and(
            eq(businessEngagementsTable.entityType, entityType),
            eq(businessEngagementsTable.entityId, entityId),
            eq(businessEngagementsTable.userId, user.id),
            eq(businessEngagementsTable.kind, kind),
          ),
        )
        .returning({ id: businessEngagementsTable.id });
      if (deleted.length > 0) {
        await bumpChildCounter(tx, entityType, entityId, kind, -1);
      }
      return false;
    });

    res.json({ active });
  };
}

router.post(
  "/businesses/:handle/:entityType/:entityId/like",
  requireAuth(),
  engagementHandler("like"),
);
router.post(
  "/businesses/:handle/:entityType/:entityId/save",
  requireAuth(),
  engagementHandler("save"),
);

// Report a business child entity → feeds the admin report queue.
router.post(
  "/businesses/:handle/:entityType/:entityId/report",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const entityType = parseHandle(req.params.entityType);
    const allowedTypes = new Set(["post", "comment", "media", "event", "product", "offer", "checkin"]);
    if (!allowedTypes.has(entityType)) {
      res.status(400).json({ error: "Unknown entity type" });
      return;
    }
    const { allowed, isManagementView } = await resolveChildReadAccess(biz, user);
    if (!allowed) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const entityId = parseId(req.params.entityId);
    if (!Number.isFinite(entityId) || entityId <= 0) {
      res.status(400).json({ error: "Invalid entity id" });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    const details = typeof req.body?.details === "string" ? req.body.details.trim() || null : null;

    // ── Validate the report TARGET before inserting. The target must exist,
    // belong to THIS business, and be public/reportable (not removed/private).
    // Reject fabricated / private / nonexistent ids with 404. Reporters are
    // treated as public (non-management) unless they are team/admin, so a
    // hidden/removed item is not reportable by an ordinary member.
    if (entityType === "post") {
      const [post] = await db
        .select({ status: businessPostsTable.status })
        .from(businessPostsTable)
        .where(and(eq(businessPostsTable.id, entityId), eq(businessPostsTable.businessId, biz.id)));
      if (!post || post.status === "removed" || (post.status !== "active" && !isManagementView)) {
        res.status(404).json({ error: "Reported content not found" });
        return;
      }
    } else if (entityType === "comment") {
      // Comment must exist, belong to this business, be reportable (not removed;
      // hidden only reportable in management view), AND its parent entity must
      // be a valid engageable child of the same business.
      const [comment] = await db
        .select({
          status: businessChildCommentsTable.status,
          parentType: businessChildCommentsTable.entityType,
          parentId: businessChildCommentsTable.entityId,
        })
        .from(businessChildCommentsTable)
        .where(
          and(
            eq(businessChildCommentsTable.id, entityId),
            eq(businessChildCommentsTable.businessId, biz.id),
          ),
        );
      if (
        !comment ||
        comment.status === "removed" ||
        (comment.status !== "active" && !isManagementView)
      ) {
        res.status(404).json({ error: "Reported content not found" });
        return;
      }
      const parentType = comment.parentType as ChildEntityType;
      if (!CHILD_ENTITY_TYPES.has(parentType)) {
        res.status(404).json({ error: "Reported content not found" });
        return;
      }
      const parentOk = await loadEngageableChild(
        biz,
        parentType,
        comment.parentId,
        isManagementView,
      );
      if (!parentOk) {
        res.status(404).json({ error: "Reported content not found" });
        return;
      }
    } else {
      // media | event | product | offer | checkin — reuse the existing
      // per-entity visibility predicate (public unless management viewer).
      const childType = entityType as ChildEntityType;
      const ok = await loadEngageableChild(biz, childType, entityId, isManagementView);
      if (!ok) {
        res.status(404).json({ error: "Reported content not found" });
        return;
      }
    }

    const inserted = await db
      .insert(businessContentReportsTable)
      .values({ businessId: biz.id, entityType, entityId, reporterUserId: user.id, reason, details })
      .onConflictDoNothing()
      .returning({ id: businessContentReportsTable.id });
    res.status(inserted.length > 0 ? 201 : 200).json({
      reported: true,
      alreadyReported: inserted.length === 0,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Business mentions — management list / approve / reject (page team).
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/businesses/:handle/mentions",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canModerateContent(role) && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
    const conditions = [eq(businessMentionsTable.businessId, biz.id)];
    if (statusFilter) conditions.push(eq(businessMentionsTable.status, statusFilter));
    const rows = await db
      .select()
      .from(businessMentionsTable)
      .where(and(...conditions))
      .orderBy(desc(businessMentionsTable.createdAt))
      .limit(100);
    res.json(
      rows.map((m) => ({
        id: m.id,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        authorUserId: m.authorUserId,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      })),
    );
  },
);

router.patch(
  "/businesses/:handle/mentions/:mentionId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canModerateContent(role) && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    const mentionId = parseId(req.params.mentionId);
    const action = req.body?.action;
    if (action !== "approve" && action !== "reject") {
      res.status(400).json({ error: "action must be 'approve' or 'reject'" });
      return;
    }
    const [updated] = await db
      .update(businessMentionsTable)
      .set({ status: action === "approve" ? "approved" : "rejected" })
      .where(
        and(
          eq(businessMentionsTable.id, mentionId),
          eq(businessMentionsTable.businessId, biz.id),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Mention not found" });
      return;
    }
    res.json({ id: updated.id, status: updated.status });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin report queue — platform admin only. List + dismiss/action.
// Actioning is logged to the business moderation audit log.
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/admin/business-reports",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const statusFilter = typeof req.query.status === "string" ? req.query.status : "open";
    const entityTypeFilter = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
    const conditions = [eq(businessContentReportsTable.status, statusFilter)];
    if (entityTypeFilter) conditions.push(eq(businessContentReportsTable.entityType, entityTypeFilter));
    const rows = await db
      .select()
      .from(businessContentReportsTable)
      .where(and(...conditions))
      .orderBy(desc(businessContentReportsTable.createdAt))
      .limit(200);
    res.json(
      rows.map((r) => ({
        id: r.id,
        businessId: r.businessId,
        entityType: r.entityType,
        entityId: r.entityId,
        reporterUserId: r.reporterUserId,
        reason: r.reason,
        details: r.details ?? null,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  },
);

router.patch(
  "/admin/business-reports/:reportId",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const reportId = parseId(req.params.reportId);
    const action = req.body?.action;
    if (action !== "dismiss" && action !== "action") {
      res.status(400).json({ error: "action must be 'dismiss' or 'action'" });
      return;
    }
    const [report] = await db
      .select()
      .from(businessContentReportsTable)
      .where(eq(businessContentReportsTable.id, reportId));
    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    const [updated] = await db
      .update(businessContentReportsTable)
      .set({
        status: action === "dismiss" ? "dismissed" : "actioned",
        reviewedByUserId: user.id,
        reviewedAt: new Date(),
      })
      .where(eq(businessContentReportsTable.id, reportId))
      .returning();
    await db.insert(businessModerationLogsTable).values({
      businessId: report.businessId,
      actorUserId: user.id,
      action: action === "dismiss" ? "dismiss_report" : "action_report",
      targetEntityType: report.entityType,
      targetEntityId: report.entityId,
      reason: typeof req.body?.reason === "string" ? req.body.reason : null,
    });
    res.json({ id: updated.id, status: updated.status });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Unified child comments — list / create / delete for public business child
// entities (media | event | product | offer | checkin). Comments live in
// businessChildCommentsTable; the parent row's comment_count is maintained
// transactionally on real INSERT/soft-delete. Public callers can only comment
// on publicly visible, non-removed content; team/admin private reads allowed.
// ─────────────────────────────────────────────────────────────────────────────

// All five child entities carry a comment_count column.
const CHILD_COMMENT_COUNT_COLUMN: Record<ChildEntityType, string> = {
  media: "comment_count",
  event: "comment_count",
  product: "comment_count",
  offer: "comment_count",
  checkin: "comment_count",
};

async function bumpChildCommentCount(
  tx: DbTx,
  entityType: ChildEntityType,
  entityId: number,
  delta: 1 | -1,
): Promise<void> {
  const col = CHILD_COMMENT_COUNT_COLUMN[entityType];
  const table = CHILD_TABLE[entityType];
  const expr =
    delta === 1
      ? sql.raw(`${col} = ${col} + 1`)
      : sql.raw(`${col} = greatest(${col} - 1, 0)`);
  await tx.execute(sql`UPDATE ${sql.raw(table)} SET ${expr} WHERE id = ${entityId}`);
}

// GET comments — visible active comments (team/admin also see hidden).
router.get(
  "/businesses/:handle/:entityType/:entityId/comments",
  async (req, res): Promise<void> => {
    const viewer = await getSessionUser(req);
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const entityType = parseHandle(req.params.entityType) as ChildEntityType;
    if (!CHILD_ENTITY_TYPES.has(entityType)) {
      res.status(404).json({ error: "Unknown entity type" });
      return;
    }
    const { allowed, isManagementView } = await resolveChildReadAccess(biz, viewer);
    if (!allowed) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const entityId = parseId(req.params.entityId);
    // The parent entity itself must be publicly visible (or management view).
    const exists = await loadEngageableChild(biz, entityType, entityId, isManagementView);
    if (!exists) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const conditions = [
      eq(businessChildCommentsTable.businessId, biz.id),
      eq(businessChildCommentsTable.entityType, entityType),
      eq(businessChildCommentsTable.entityId, entityId),
    ];
    // Public sees only active comments; management preview also sees hidden.
    if (!isManagementView) conditions.push(eq(businessChildCommentsTable.status, "active"));
    else conditions.push(sql`${businessChildCommentsTable.status} <> 'removed'`);
    const rows = await db
      .select()
      .from(businessChildCommentsTable)
      .where(and(...conditions))
      .orderBy(desc(businessChildCommentsTable.createdAt))
      .limit(200);
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users =
      userIds.length > 0
        ? await db
            .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
            .from(usersTable)
            .where(inArray(usersTable.id, userIds))
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    res.json(
      rows.map((c) => ({
        id: c.id,
        entityType: c.entityType,
        entityId: c.entityId,
        userId: c.userId,
        userName: userMap.get(c.userId)?.name ?? "Unknown",
        userPhotoUrl: userMap.get(c.userId)?.profilePhotoUrl ?? null,
        text: c.text,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
    );
  },
);

// POST comment — authenticated; parent must be publicly engageable (or team).
router.post(
  "/businesses/:handle/:entityType/:entityId/comments",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const entityType = parseHandle(req.params.entityType) as ChildEntityType;
    if (!CHILD_ENTITY_TYPES.has(entityType)) {
      res.status(404).json({ error: "Unknown entity type" });
      return;
    }
    const { allowed, isManagementView } = await resolveChildReadAccess(biz, user);
    if (!allowed) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const entityId = parseId(req.params.entityId);
    const exists = await loadEngageableChild(biz, entityType, entityId, isManagementView);
    if (!exists) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    if (text.length > 2000) {
      res.status(400).json({ error: "text exceeds 2000 characters" });
      return;
    }
    const created = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(businessChildCommentsTable)
        .values({ businessId: biz.id, entityType, entityId, userId: user.id, text })
        .returning();
      await bumpChildCommentCount(tx, entityType, entityId, 1);
      return c;
    });
    res.status(201).json({
      id: created.id,
      entityType: created.entityType,
      entityId: created.entityId,
      userId: created.userId,
      userName: user.name,
      userPhotoUrl: user.profilePhotoUrl ?? null,
      text: created.text,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    });
  },
);

// DELETE comment — author, team moderator, or admin. Conditional soft-delete
// with RETURNING so comment_count decrements exactly once. Admin removals set a
// moderation lock the team cannot silently override.
router.delete(
  "/businesses/:handle/:entityType/:entityId/comments/:commentId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const entityType = parseHandle(req.params.entityType) as ChildEntityType;
    if (!CHILD_ENTITY_TYPES.has(entityType)) {
      res.status(404).json({ error: "Unknown entity type" });
      return;
    }
    const commentId = parseId(req.params.commentId);
    const [existing] = await db
      .select()
      .from(businessChildCommentsTable)
      .where(
        and(
          eq(businessChildCommentsTable.id, commentId),
          eq(businessChildCommentsTable.businessId, biz.id),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    const isModerator = canModerateContent(role);
    const isAuthor = existing.userId === user.id;
    if (!isAuthor && !isModerator && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    // A moderation-locked comment can only be changed by a platform admin.
    if (existing.moderationLocked && !isAdmin) {
      res.status(403).json({ error: "Comment is moderation-locked" });
      return;
    }
    const removed = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(businessChildCommentsTable)
        .set({ status: "removed", moderationLocked: isAdmin ? true : existing.moderationLocked })
        .where(
          and(
            eq(businessChildCommentsTable.id, commentId),
            eq(businessChildCommentsTable.status, "active"),
          ),
        )
        .returning({ id: businessChildCommentsTable.id });
      if (updated) {
        await bumpChildCommentCount(tx, entityType, existing.entityId, -1);
        return true;
      }
      // Not active (already hidden/removed): update status without touching the
      // counter, but still record the moderation lock for admin removals.
      if (isAdmin && !existing.moderationLocked) {
        await tx
          .update(businessChildCommentsTable)
          .set({ status: "removed", moderationLocked: true })
          .where(eq(businessChildCommentsTable.id, commentId));
      }
      return false;
    });
    if (isAdmin) {
      await db.insert(businessModerationLogsTable).values({
        businessId: biz.id,
        actorUserId: user.id,
        action: "remove_child_comment",
        targetEntityType: `${entityType}_comment`,
        targetEntityId: commentId,
        reason: typeof req.body?.reason === "string" ? req.body.reason : null,
      });
    }
    res.json({ removed });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Customer media submissions — a visitor may submit a photo/video for a page;
// it lands in `pending` and requires owner/admin/editor approval to go live.
// ─────────────────────────────────────────────────────────────────────────────

// Public/authenticated visitor submission (source=customer, status=pending).
router.post(
  "/businesses/:handle/media/submissions",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    // Page must be publicly live to accept customer submissions.
    if (!(biz.isPublished && biz.status === "active")) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const kind = typeof body.kind === "string" ? body.kind : "photo";
    if (!["photo", "video", "reel"].includes(kind)) {
      res.status(400).json({ error: "kind must be one of: photo, video, reel" });
      return;
    }
    const rawMediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl : "";
    if (!rawMediaUrl) {
      res.status(400).json({ error: "mediaUrl is required" });
      return;
    }
    let mediaUrl: string;
    let posterUrl: string | null = null;
    try {
      const finalized = await finalizeInternalMedia(
        rawMediaUrl,
        kind === "photo" ? "image" : "video",
        user.id,
      );
      mediaUrl = finalized.url;
      posterUrl = finalized.posterUrl;
    } catch (err) {
      if (err instanceof InvalidUploadError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
    const [item] = await db
      .insert(businessMediaItemsTable)
      .values({
        businessId: biz.id,
        kind,
        caption: typeof body.caption === "string" ? body.caption : null,
        mediaUrl,
        posterUrl,
        source: "customer",
        submittedByUserId: user.id,
        status: "pending",
      })
      .returning();
    res.status(201).json(serializeMediaItem(item));
  },
);

// Owner/admin/editor: approve or reject a pending customer submission.
router.patch(
  "/businesses/:handle/media/:mediaId/review",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const isAdmin = user.role === "admin";
    const role = await getTeamRole(biz.id, user.id);
    if (!canEditContent(role) && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    if (isWriteBlocked(biz, isAdmin)) {
      res.status(409).json({ error: `Business is ${biz.status} and cannot be modified` });
      return;
    }
    const action = req.body?.action;
    if (action !== "approve" && action !== "reject") {
      res.status(400).json({ error: "action must be 'approve' or 'reject'" });
      return;
    }
    const mediaId = parseId(req.params.mediaId);
    // Only transition rows that are currently pending (conditional predicate).
    const [updated] = await db
      .update(businessMediaItemsTable)
      .set({ status: action === "approve" ? "active" : "rejected" })
      .where(
        and(
          eq(businessMediaItemsTable.id, mediaId),
          eq(businessMediaItemsTable.businessId, biz.id),
          eq(businessMediaItemsTable.status, "pending"),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "No pending submission found" });
      return;
    }
    res.json(serializeMediaItem(updated));
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Reel/video view count — public increment with authenticated per-user
// idempotence. No anonymous dedupe primitive exists in this project, so views
// require auth and are recorded once per (media, user) via businessEngagements
// (kind='view', unique index). Repeated calls by the same user do not re-count.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/businesses/:handle/media/:mediaId/view",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const biz = await getBusinessByHandle(parseHandle(req.params.handle));
    if (!biz) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const { allowed, isManagementView } = await resolveChildReadAccess(biz, user);
    if (!allowed) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const mediaId = parseId(req.params.mediaId);
    const exists = await loadEngageableChild(biz, "media", mediaId, isManagementView);
    if (!exists) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(businessEngagementsTable)
        .values({ businessId: biz.id, entityType: "media", entityId: mediaId, userId: user.id, kind: "view" })
        .onConflictDoNothing()
        .returning({ id: businessEngagementsTable.id });
      if (inserted.length > 0) {
        await tx.execute(
          sql`UPDATE business_media_items SET view_count = view_count + 1 WHERE id = ${mediaId}`,
        );
      }
    });
    res.sendStatus(204);
  },
);

export default router;
