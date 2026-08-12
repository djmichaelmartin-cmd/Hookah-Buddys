import { eq, inArray } from "drizzle-orm";
import { db, hashtagsTable, postHashtagsTable } from "@workspace/db";

// Matches #Word tokens: letters, digits, underscores; must contain at least one letter.
const HASHTAG_RE = /#([A-Za-z0-9_]*[A-Za-z][A-Za-z0-9_]*)/g;
const MAX_TAG_LENGTH = 50;
const MAX_TAGS_PER_POST = 10;

/** Extract unique hashtags from post text. Returns display-cased tags without '#'. */
export function extractHashtags(text: string): string[] {
  const seen = new Map<string, string>();
  for (const match of text.matchAll(HASHTAG_RE)) {
    const display = match[1];
    if (display.length > MAX_TAG_LENGTH) continue;
    const key = display.toLowerCase();
    if (!seen.has(key)) seen.set(key, display);
    if (seen.size >= MAX_TAGS_PER_POST) break;
  }
  return [...seen.values()];
}

/** Parse `text` and sync hashtag + post_hashtags rows for a post. */
export async function syncPostHashtags(postId: number, text: string): Promise<void> {
  const tags = extractHashtags(text);
  const hashtagIds: number[] = [];
  for (const display of tags) {
    const key = display.toLowerCase();
    const inserted = await db
      .insert(hashtagsTable)
      .values({ tag: key, displayTag: display })
      .onConflictDoNothing({ target: hashtagsTable.tag })
      .returning();
    if (inserted.length > 0) {
      hashtagIds.push(inserted[0].id);
    } else {
      const [existing] = await db.select().from(hashtagsTable).where(eq(hashtagsTable.tag, key));
      if (existing) hashtagIds.push(existing.id);
    }
  }
  // Replace the post's hashtag links with the current set.
  await db.delete(postHashtagsTable).where(eq(postHashtagsTable.postId, postId));
  if (hashtagIds.length > 0) {
    await db
      .insert(postHashtagsTable)
      .values(hashtagIds.map((hashtagId) => ({ postId, hashtagId })))
      .onConflictDoNothing();
  }
}

/** Remove all hashtag links for a deleted post. */
export async function removePostHashtags(postId: number): Promise<void> {
  await db.delete(postHashtagsTable).where(eq(postHashtagsTable.postId, postId));
}

/** Remove hashtag links for many posts at once. */
export async function removePostHashtagsBulk(postIds: number[]): Promise<void> {
  if (postIds.length === 0) return;
  await db.delete(postHashtagsTable).where(inArray(postHashtagsTable.postId, postIds));
}
