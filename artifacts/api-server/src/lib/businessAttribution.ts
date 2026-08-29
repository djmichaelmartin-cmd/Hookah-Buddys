import { and, eq, inArray } from "drizzle-orm";
import {
  businessPageRolesTable,
  businessesTable,
  db,
} from "@workspace/db";
import { hasBusinessCapability, type BusinessTeamRole } from "./businessPolicies";

export type BusinessAttribution = {
  id: number;
  name: string;
  handle: string;
  logoUrl: string | null;
};

export function canUseBusinessForEvent(
  businessStatus: string,
  isPublished: boolean,
  role: BusinessTeamRole | null,
): boolean {
  return businessStatus === "active" && isPublished && hasBusinessCapability(role, "content");
}

export function serializeEventBusinessAttribution(
  businessId: number | null | undefined,
  business: BusinessAttribution | null | undefined,
) {
  return {
    businessId: businessId ?? null,
    businessName: business?.name ?? null,
    businessHandle: business?.handle ?? null,
    businessLogoUrl: business?.logoUrl ?? null,
  };
}

/**
 * Recurrence materializers must copy attribution from the source event rather
 * than re-authorizing the worker/organizer. The latter could silently strip a
 * page after a role change and would violate historical attribution.
 */
export function inheritedEventBusinessId(parent: {
  businessId: number | null | undefined;
}): number | null {
  return parent.businessId ?? null;
}

/**
 * A page may be selected as an event host only while it is active and the
 * caller has a page role capable of creating content. This check is deliberately
 * performed only when attribution is selected/changed; existing events retain
 * their stored attribution if the role or page status later changes.
 */
export async function getAuthorizedEventBusiness(
  businessId: number,
  userId: number,
): Promise<BusinessAttribution | null> {
  const [row] = await db
    .select({
      id: businessesTable.id,
      name: businessesTable.name,
      handle: businessesTable.handle,
      logoUrl: businessesTable.logoUrl,
      status: businessesTable.status,
      isPublished: businessesTable.isPublished,
      role: businessPageRolesTable.role,
    })
    .from(businessPageRolesTable)
    .innerJoin(
      businessesTable,
      eq(businessesTable.id, businessPageRolesTable.businessId),
    )
    .where(
      and(
        eq(businessPageRolesTable.businessId, businessId),
        eq(businessPageRolesTable.userId, userId),
      ),
    )
    .limit(1);

  if (
    !row ||
    !canUseBusinessForEvent(row.status, row.isPublished, row.role as BusinessTeamRole)
  ) {
    return null;
  }
  return { id: row.id, name: row.name, handle: row.handle, logoUrl: row.logoUrl };
}

/**
 * Resolve persisted page identities without re-checking current management
 * access. This is what lets historical attribution remain visible after a team
 * member is removed. One query serves an entire event list.
 */
export async function loadBusinessAttributions(
  businessIds: Array<number | null | undefined>,
): Promise<Map<number, BusinessAttribution>> {
  const ids = [...new Set(businessIds.filter((id): id is number => id != null))];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      id: businessesTable.id,
      name: businessesTable.name,
      handle: businessesTable.handle,
      logoUrl: businessesTable.logoUrl,
    })
    .from(businessesTable)
    .where(inArray(businessesTable.id, ids));

  return new Map(rows.map((row) => [row.id, row]));
}