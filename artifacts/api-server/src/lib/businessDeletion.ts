import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { toObjectEntityPath } from "./imageUploads";
import { logger } from "./logger";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";

export class BusinessDeletionNotFoundError extends Error {
  constructor() {
    super("Business not found");
    this.name = "BusinessDeletionNotFoundError";
  }
}

export class BusinessDeletionConfirmationError extends Error {
  constructor() {
    super("Confirmation handle does not match the business handle");
    this.name = "BusinessDeletionConfirmationError";
  }
}

export interface BusinessDeletionResult {
  deleted: true;
  businessId: number;
  handle: string;
  deletedObjectCount: number;
  objectCleanupFailureCount: number;
}

interface LockedBusinessRow {
  id: number;
  handle: string;
}

interface UrlRow {
  url: string | null;
}

interface IdRow {
  id: number;
}

function resultRows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function normalizedConfirmation(value: string): string {
  return value.trim().toLowerCase();
}

function managedObjectPath(value: string | null | undefined): string | null {
  if (!value) return null;
  return toObjectEntityPath(value) ?? (value.startsWith("/objects/") ? value : null);
}

async function deleteExclusivelyBusinessOwnedObjects(
  candidateUrls: Iterable<string>,
  businessId: number,
): Promise<{ deletedObjectCount: number; objectCleanupFailureCount: number }> {
  const objectPaths = new Set<string>();
  const requiredPrefix = `/objects/verification/${businessId}/`;
  for (const url of candidateUrls) {
    const objectPath = managedObjectPath(url);
    if (objectPath?.startsWith(requiredPrefix)) objectPaths.add(objectPath);
  }

  const storage = new ObjectStorageService();
  let deletedObjectCount = 0;
  let objectCleanupFailureCount = 0;

  for (const objectPath of objectPaths) {
    try {
      const file = await storage.getObjectEntityFile(objectPath);
      const [metadata] = await file.getMetadata();
      const scopedBusinessId = metadata.metadata?.verificationBusinessId;
      if (String(scopedBusinessId ?? "") !== String(businessId)) {
        logger.warn(
          { businessId, objectPath },
          "Skipped Business deletion object cleanup because its ownership metadata did not match",
        );
        continue;
      }
      await file.delete();
      deletedObjectCount += 1;
    } catch (error) {
      if (error instanceof ObjectNotFoundError) continue;
      objectCleanupFailureCount += 1;
      logger.warn(
        { err: error, objectPath },
        "Business deletion committed but an exclusively owned object could not be removed",
      );
    }
  }

  return { deletedObjectCount, objectCleanupFailureCount };
}

/**
 * Permanently deletes a Business Page and every row authored or owned by that
 * page. The member account is deliberately never part of this transaction.
 *
 * Database work is all-or-nothing. Object deletion happens only after commit
 * and is limited to immutable verification/{businessId}/ keys whose storage
 * metadata independently confirms that Business ID. Member-owned upload keys
 * are deliberately retained because they may be reused by unrelated content.
 */
export async function deleteBusinessPermanently(
  rawHandle: string,
  confirmHandle: string,
): Promise<BusinessDeletionResult> {
  const requestedHandle = normalizedConfirmation(rawHandle);
  const confirmation = normalizedConfirmation(confirmHandle);
  const candidateUrls = new Set<string>();

  const targetResult = await db.execute(sql`
    SELECT id, handle
    FROM businesses
    WHERE lower(handle) = ${requestedHandle}
  `);
  const [target] = resultRows<LockedBusinessRow>(targetResult);
  if (!target) throw new BusinessDeletionNotFoundError();

  const deletedBusiness = await db.transaction(async (tx) => {
    // Verification submission creation takes this same lock and revalidates the
    // Business row before insert. Acquiring it before FOR UPDATE avoids a lock-
    // ordering deadlock and guarantees no successful submission can appear
    // between dependency collection and the final Business delete.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${target.id})`);
    const lockedResult = await tx.execute(sql`
      SELECT id, handle
      FROM businesses
      WHERE id = ${target.id} AND lower(handle) = ${requestedHandle}
      FOR UPDATE
    `);
    const [business] = resultRows<LockedBusinessRow>(lockedResult);
    if (!business) throw new BusinessDeletionNotFoundError();
    if (confirmation !== business.handle.toLowerCase()) {
      throw new BusinessDeletionConfirmationError();
    }

    const assetResult = await tx.execute(sql`
      SELECT unnest(document_urls) AS url
      FROM business_verification_submissions
      WHERE business_id = ${business.id}
    `);
    for (const row of resultRows<UrlRow>(assetResult)) {
      if (row.url) candidateUrls.add(row.url);
    }

    const affectedGroupResult = await tx.execute(sql`
      SELECT DISTINCT group_id AS id
      FROM group_posts
      WHERE business_id = ${business.id}
      UNION
      SELECT DISTINCT group_id AS id
      FROM group_media
      WHERE business_id = ${business.id}
         OR post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
    `);
    const affectedGroupIds = resultRows<IdRow>(affectedGroupResult).map((row) => row.id);

    // Mentions can point at the deleted page or originate from its authored rows.
    await tx.execute(sql`
      DELETE FROM business_mentions
      WHERE business_id = ${business.id}
         OR (
           source_type = 'business_post'
           AND source_id IN (SELECT id FROM business_posts WHERE business_id = ${business.id})
         )
         OR (
           source_type = 'feed_post'
           AND source_id IN (SELECT id FROM feed_posts WHERE business_id = ${business.id})
         )
    `);

    // Remove canonical feed copies and their engagement/hashtag children.
    await tx.execute(sql`
      DELETE FROM post_reports
      WHERE post_id IN (SELECT id FROM feed_posts WHERE business_id = ${business.id})
         OR comment_id IN (
           SELECT id FROM post_comments
           WHERE post_id IN (SELECT id FROM feed_posts WHERE business_id = ${business.id})
         )
    `);
    await tx.execute(sql`
      DELETE FROM post_hashtags
      WHERE post_id IN (SELECT id FROM feed_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM post_likes
      WHERE post_id IN (SELECT id FROM feed_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM post_saves
      WHERE post_id IN (SELECT id FROM feed_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM post_comments
      WHERE post_id IN (SELECT id FROM feed_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`DELETE FROM feed_posts WHERE business_id = ${business.id}`);

    // Remove Group content explicitly authored as the Business Page. Group
    // membership, the Group itself, and personal member content are preserved.
    await tx.execute(sql`
      DELETE FROM group_reports
      WHERE (target_type = 'post' AND target_id IN (
          SELECT id FROM group_posts WHERE business_id = ${business.id}
        ))
         OR (target_type = 'comment' AND target_id IN (
          SELECT id FROM group_post_comments
          WHERE post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
        ))
         OR (target_type = 'media' AND target_id IN (
          SELECT id FROM group_media
          WHERE business_id = ${business.id}
             OR post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
        ))
    `);
    await tx.execute(sql`
      DELETE FROM group_activity_log
      WHERE (target_type = 'post' AND target_id IN (
          SELECT id FROM group_posts WHERE business_id = ${business.id}
        ))
         OR (target_type = 'comment' AND target_id IN (
          SELECT id FROM group_post_comments
          WHERE post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
        ))
         OR (target_type = 'media' AND target_id IN (
          SELECT id FROM group_media
          WHERE business_id = ${business.id}
             OR post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
        ))
    `);
    await tx.execute(sql`
      DELETE FROM group_notifications
      WHERE (related_entity_type = 'post' AND related_entity_id IN (
          SELECT id FROM group_posts WHERE business_id = ${business.id}
        ))
         OR (related_entity_type = 'comment' AND related_entity_id IN (
          SELECT id FROM group_post_comments
          WHERE post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
        ))
         OR (related_entity_type = 'media' AND related_entity_id IN (
          SELECT id FROM group_media
          WHERE business_id = ${business.id}
             OR post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
        ))
    `);
    await tx.execute(sql`
      DELETE FROM group_featured_content
      WHERE (content_type = 'post' AND content_id IN (
          SELECT id FROM group_posts WHERE business_id = ${business.id}
        ))
         OR (content_type = 'media' AND content_id IN (
          SELECT id FROM group_media
          WHERE business_id = ${business.id}
             OR post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
        ))
    `);
    await tx.execute(sql`
      DELETE FROM group_media
      WHERE business_id = ${business.id}
         OR post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM group_post_poll_votes
      WHERE post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM group_post_reactions
      WHERE post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM group_post_saves
      WHERE post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM group_post_comments
      WHERE post_id IN (SELECT id FROM group_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`DELETE FROM group_posts WHERE business_id = ${business.id}`);
    for (const groupId of affectedGroupIds) {
      await tx.execute(sql`
        UPDATE groups
        SET post_count = (
          SELECT count(*)::int
          FROM group_posts
          WHERE group_id = ${groupId} AND status = 'active'
        ),
        updated_at = now()
        WHERE id = ${groupId}
      `);
    }

    // Delete deepest Business Page children before their parents.
    await tx.execute(sql`
      DELETE FROM business_post_likes
      WHERE post_id IN (SELECT id FROM business_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM business_post_comments
      WHERE post_id IN (SELECT id FROM business_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM business_post_saves
      WHERE post_id IN (SELECT id FROM business_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM business_post_reports
      WHERE post_id IN (SELECT id FROM business_posts WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM business_review_replies
      WHERE review_id IN (SELECT id FROM business_reviews WHERE business_id = ${business.id})
    `);
    await tx.execute(sql`
      DELETE FROM business_messages
      WHERE conversation_id IN (
        SELECT id FROM business_conversations WHERE business_id = ${business.id}
      )
    `);
    await tx.execute(sql`
      DELETE FROM business_event_rsvps
      WHERE event_id IN (SELECT id FROM business_events WHERE business_id = ${business.id})
    `);

    for (const tableName of [
      "business_engagements",
      "business_child_comments",
      "business_content_reports",
      "business_notifications",
      "business_insight_events",
      "business_verification_submissions",
      "business_media_items",
      "business_albums",
      "business_appointments",
      "business_events",
      "business_offers",
      "business_products",
      "business_services",
      "business_reviews",
      "business_posts",
      "business_check_ins",
      "business_conversations",
      "business_follows",
      "business_saves",
      "business_page_roles",
      "business_moderation_logs",
    ] as const) {
      await tx.execute(
        sql.raw(`DELETE FROM ${tableName} WHERE business_id = ${business.id}`),
      );
    }

    await tx.execute(
      sql`DELETE FROM business_spotlight_locations WHERE business_id = ${business.id}`,
    );
    await tx.execute(sql`
      DELETE FROM daily_lounge_spotlights
      WHERE ',' || business_ids || ',' LIKE ${`%,${business.id},%`}
    `);
    await tx.execute(sql`DELETE FROM businesses WHERE id = ${business.id}`);

    return business;
  });

  const cleanup = await deleteExclusivelyBusinessOwnedObjects(
    candidateUrls,
    deletedBusiness.id,
  );
  return {
    deleted: true,
    businessId: deletedBusiness.id,
    handle: deletedBusiness.handle,
    ...cleanup,
  };
}