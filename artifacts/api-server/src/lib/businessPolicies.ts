export const ALL_ASSIGNABLE_BUSINESS_ROLES = [
  "admin",
  "editor",
  "moderator",
  "advertiser",
  "analyst",
  "support_agent",
] as const;

export type AssignableBusinessRole = (typeof ALL_ASSIGNABLE_BUSINESS_ROLES)[number];
export type BusinessTeamRole = "owner" | AssignableBusinessRole;

export type BusinessCapability =
  | "management"
  | "settings"
  | "publish"
  | "content"
  | "offers"
  | "moderation"
  | "inbox";

export const MAX_APPOINTMENT_DURATION_MINUTES = 24 * 60;

const CAPABILITIES: Record<BusinessCapability, ReadonlySet<BusinessTeamRole>> = {
  management: new Set(["owner", "admin", "analyst"]),
  settings: new Set(["owner", "admin"]),
  publish: new Set(["owner"]),
  content: new Set(["owner", "admin", "editor"]),
  offers: new Set(["owner", "admin", "editor", "advertiser"]),
  moderation: new Set(["owner", "admin", "moderator"]),
  inbox: new Set(["owner", "admin", "support_agent"]),
};

export function isValidAssignableBusinessRole(role: unknown): role is AssignableBusinessRole {
  return ALL_ASSIGNABLE_BUSINESS_ROLES.includes(role as AssignableBusinessRole);
}

export function hasBusinessCapability(
  role: BusinessTeamRole | null,
  capability: BusinessCapability,
): boolean {
  return role !== null && CAPABILITIES[capability].has(role);
}

export function isAnyBusinessTeamRole(role: BusinessTeamRole | null): boolean {
  return role !== null;
}

export function isBusinessPubliclyVisible(business: {
  status: string;
  isPublished: boolean;
}): boolean {
  return business.status === "active" && business.isPublished === true;
}

export function isBusinessWriteBlocked(
  business: { status: string },
  isPlatformAdmin: boolean,
): boolean {
  return !isPlatformAdmin && (business.status === "suspended" || business.status === "closed");
}

export function selectPublicOwnerIdentity<T>(
  showOwner: boolean,
  owner: T | null,
): T | null {
  return showOwner ? owner : null;
}

export function getBufferedAppointmentInterval(options: {
  startsAt: Date;
  durationMinutes: number;
  bufferMinutes: number;
}): { startsAt: Date; endsAt: Date } {
  const bufferMs = Math.max(0, options.bufferMinutes) * 60_000;
  const durationMs = Math.max(0, options.durationMinutes) * 60_000;
  return {
    startsAt: new Date(options.startsAt.getTime() - bufferMs),
    endsAt: new Date(options.startsAt.getTime() + durationMs + bufferMs),
  };
}

export type ParsedAppointmentDuration =
  | { valid: true; value: number | undefined }
  | { valid: false };

export function parseAppointmentDuration(value: unknown): ParsedAppointmentDuration {
  if (value === undefined) return { valid: true, value: undefined };
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_APPOINTMENT_DURATION_MINUTES
  ) {
    return { valid: false };
  }
  return { valid: true, value };
}

export function resolveAppointmentDuration(
  value: unknown,
  fallbackMinutes: unknown = 60,
): number {
  const parsed = parseAppointmentDuration(value);
  if (parsed.valid && parsed.value !== undefined) return parsed.value;
  const fallback = parseAppointmentDuration(fallbackMinutes);
  return fallback.valid && fallback.value !== undefined ? fallback.value : 60;
}

export function appointmentIntervalsConflict(
  requested: {
    startsAt: Date;
    durationMinutes: number;
    bufferMinutes: number;
  },
  existing: {
    startsAt: Date;
    durationMinutes: number | null;
    status: string;
  },
  existingDefaultDurationMinutes: number = 60,
): boolean {
  if (existing.status !== "pending" && existing.status !== "confirmed") return false;
  const interval = getBufferedAppointmentInterval(requested);
  const existingEnd = new Date(
    existing.startsAt.getTime() +
      resolveAppointmentDuration(
        existing.durationMinutes ?? undefined,
        existingDefaultDurationMinutes,
      ) *
        60_000,
  );
  return existing.startsAt < interval.endsAt && existingEnd > interval.startsAt;
}