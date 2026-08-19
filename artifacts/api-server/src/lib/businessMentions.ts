import { eq, inArray } from "drizzle-orm";
import {
  db,
  businessesTable,
  businessMentionsTable,
  businessPageRolesTable,
  businessNotificationsTable,
} from "@workspace/db";

/** A drizzle transaction/queryable handle (transaction OR the base db). */
type DbLike = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * Parses business @handles from free text. Returns the set of normalized
 * handles referenced (letters/numbers/underscore/period, no hyphen — matching
 * our handle rules). Used to create business mention records.
 */
export function parseBusinessMentions(text: string): string[] {
  const matches = text.match(/@([a-z0-9_.]{2,30})/gi) ?? [];
  const set = new Set<string>();
  for (const m of matches) set.add(m.slice(1).toLowerCase());
  return [...set];
}

/**
 * Creates business @-mention records for handles referenced in `text`.
 * Skips self-mentions and any page that is not published+active (never leaks
 * unpublished/suspended pages). Honors each target page's allowMentions +
 * approval settings: when mentions are disabled the reference is ignored; when
 * approval is required the record is created pending; otherwise approved.
 * Notifies the mentioned page team. Runs inside the caller-supplied handle
 * (transaction or base db) and is safe against duplicate source rows.
 */
export async function createBusinessMentions(
  tx: DbLike,
  opts: {
    text: string;
    sourceType: "feed_post" | "business_post";
    sourceId: number;
    authorUserId: number;
    excludeBusinessId?: number;
  },
): Promise<void> {
  const handles = parseBusinessMentions(opts.text);
  if (handles.length === 0) return;
  const targets = await tx
    .select({
      id: businessesTable.id,
      handle: businessesTable.handle,
      allowMentions: businessesTable.allowMentions,
      mentionsRequireApproval: businessesTable.mentionsRequireApproval,
      status: businessesTable.status,
      isPublished: businessesTable.isPublished,
    })
    .from(businessesTable)
    .where(inArray(businessesTable.handle, handles));
  for (const t of targets) {
    if (t.id === opts.excludeBusinessId) continue;
    if (!t.allowMentions) continue;
    // Never leak / mention unpublished or suspended pages.
    if (t.status !== "active" || !t.isPublished) continue;
    const status = t.mentionsRequireApproval ? "pending" : "approved";
    const inserted = await tx
      .insert(businessMentionsTable)
      .values({
        businessId: t.id,
        sourceType: opts.sourceType,
        sourceId: opts.sourceId,
        authorUserId: opts.authorUserId,
        status,
      })
      .onConflictDoNothing()
      .returning({ id: businessMentionsTable.id });
    if (inserted.length > 0) {
      // Notify the page team of the new mention.
      const team = await tx
        .select({ userId: businessPageRolesTable.userId })
        .from(businessPageRolesTable)
        .where(eq(businessPageRolesTable.businessId, t.id));
      if (team.length > 0) {
        await tx.insert(businessNotificationsTable).values(
          team.map((m) => ({
            businessId: t.id,
            recipientUserId: m.userId,
            type: "new_mention",
            title: "Your page was mentioned",
            message:
              status === "pending"
                ? "A mention is awaiting your approval."
                : "Your page was mentioned in a post.",
            relatedEntityId: opts.sourceId,
            relatedEntityType: opts.sourceType,
          })),
        );
      }
    }
  }
}
