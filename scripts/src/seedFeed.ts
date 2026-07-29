/**
 * Seed the public hookah feed with sample posts, likes, comments, saves,
 * follows, and notifications. Idempotent: skips if feed posts already exist.
 * Run: pnpm --filter @workspace/scripts run seed-feed
 */
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  feedPostsTable,
  postLikesTable,
  postCommentsTable,
  postSavesTable,
  followsTable,
  notificationsTable,
} from "@workspace/db";

async function main() {
  const [existing] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(feedPostsTable);
  if (existing.c > 0) {
    console.log(`Feed already seeded (${existing.c} posts). Skipping.`);
    return;
  }

  const users = await db.select().from(usersTable);
  const dolls = users.filter((u) => u.role === "doll");
  const bros = users.filter((u) => u.role === "member");
  if (dolls.length === 0 || bros.length === 0) {
    console.log("No seeded users found. Run the main seed first.");
    return;
  }

  const dollImage = (i: number) => `/dolls/doll${(i % 8) + 1}.png`;
  const loungeImage = (i: number) => `/lounge/lounge${(i % 5) + 1}.png`;

  type SeedPost = {
    user: typeof users[number];
    text: string;
    category: string;
    mediaUrl?: string;
    mediaType?: string;
    daysAgo: number;
  };

  const posts: SeedPost[] = [
    { user: dolls[0], text: "Tonight's setup: double apple with a splash of mint, ice base, and the coals just right. Come say hi in the lounge.", category: "setup", mediaUrl: dollImage(0), mediaType: "image", daysAgo: 0 },
    { user: bros[0], text: "Finally tried the new lounge downtown. Plush seating, killer playlist, and the blueberry mint bowl lasted two hours. 9/10 would smoke again.", category: "review", mediaUrl: loungeImage(0), mediaType: "image", daysAgo: 0 },
    { user: dolls[1 % dolls.length], text: "Hot take: mint belongs in every mix. Fight me in the comments.", category: "flavor", daysAgo: 1 },
    { user: bros[1 % bros.length], text: "What's everyone's go-to ice-base combo for summer sessions? Looking for something refreshing that isn't just lemon mint.", category: "question", daysAgo: 1 },
    { user: dolls[2 % dolls.length], text: "Behind the scenes from last night's session. The smoke rings were UNREAL.", category: "setup", mediaUrl: dollImage(2), mediaType: "image", daysAgo: 2 },
    { user: bros[0], text: "Hookah night this Friday at the rooftop lounge — who's pulling up? First bowl is on me.", category: "event", mediaUrl: loungeImage(2), mediaType: "image", daysAgo: 2 },
    { user: dolls[3 % dolls.length], text: "Grape mint review: smooth pull, thick clouds, flavor holds for 90+ minutes. My new weekend staple.", category: "review", daysAgo: 3 },
    { user: dolls[4 % dolls.length], text: "When the coals are perfect and the first pull hits just right... you know the night is going to be good.", category: "meme", mediaUrl: dollImage(4), mediaType: "image", daysAgo: 3 },
    { user: bros[1 % bros.length], text: "Lounge etiquette question: is it cool to ask the table next to you what they're smoking? Asking for a friend.", category: "discussion", daysAgo: 4 },
    { user: dolls[5 % dolls.length], text: "My home corner is finally complete. Velvet seating, warm lights, and my favorite stem front and center.", category: "setup", mediaUrl: loungeImage(3), mediaType: "image", daysAgo: 4 },
    { user: dolls[6 % dolls.length], text: "Flavor of the week: peach paradise with a hint of cardamom. Trust me on this one.", category: "flavor", mediaUrl: dollImage(6), mediaType: "image", daysAgo: 5 },
    { user: bros[0], text: "Anyone been to the new spot on the strip? Trying to decide between there and my usual for Saturday.", category: "lounge", mediaUrl: loungeImage(4), mediaType: "image", daysAgo: 5 },
    { user: dolls[7 % dolls.length], text: "Reminder: hydrate between pulls. Your clouds will thank you.", category: "discussion", daysAgo: 6 },
    { user: dolls[0], text: "Sunset session hits different. Golden hour plus grape mint equals perfection.", category: "lounge", mediaUrl: loungeImage(1), mediaType: "image", daysAgo: 6 },
  ];

  const inserted: { id: number; userId: number }[] = [];
  for (const p of posts) {
    const createdAt = new Date(Date.now() - p.daysAgo * 24 * 3600 * 1000 - Math.floor(Math.random() * 6) * 3600 * 1000);
    const [row] = await db
      .insert(feedPostsTable)
      .values({
        userId: p.user.id,
        userRole: p.user.role,
        text: p.text,
        mediaUrl: p.mediaUrl ?? null,
        mediaType: p.mediaUrl ? (p.mediaType ?? "image") : "none",
        category: p.category,
        isHookahRelatedConfirmed: true,
        status: "active",
        createdAt,
      })
      .returning();
    inserted.push({ id: row.id, userId: row.userId });
  }
  console.log(`Inserted ${inserted.length} feed posts`);

  // Likes & saves from various users
  const allUsers = [...dolls, ...bros];
  let likeCount = 0;
  for (const post of inserted) {
    const likers = allUsers.filter((u) => u.id !== post.userId && Math.random() < 0.55);
    for (const liker of likers) {
      await db.insert(postLikesTable).values({ postId: post.id, userId: liker.id }).onConflictDoNothing();
      likeCount++;
    }
    await db
      .update(feedPostsTable)
      .set({ likeCount: likers.length })
      .where(eq(feedPostsTable.id, post.id));
    if (Math.random() < 0.4 && bros[0]) {
      await db.insert(postSavesTable).values({ postId: post.id, userId: bros[0].id }).onConflictDoNothing();
      await db.update(feedPostsTable).set({ saveCount: 1 }).where(eq(feedPostsTable.id, post.id));
    }
  }
  console.log(`Inserted ${likeCount} likes`);

  // Comments
  const commentTexts = [
    "Those clouds though. Incredible.",
    "Adding this to my must-try list.",
    "What brand of coals are you using?",
    "This is the content I follow for.",
    "Absolutely agree — mint makes everything better.",
    "See you there Friday!",
    "That setup is gorgeous.",
  ];
  let commentTotal = 0;
  for (const post of inserted) {
    const commenters = allUsers.filter((u) => u.id !== post.userId && Math.random() < 0.3).slice(0, 3);
    for (const commenter of commenters) {
      await db.insert(postCommentsTable).values({
        postId: post.id,
        userId: commenter.id,
        commentText: commentTexts[Math.floor(Math.random() * commentTexts.length)],
      });
      commentTotal++;
    }
    if (commenters.length > 0) {
      await db
        .update(feedPostsTable)
        .set({ commentCount: commenters.length })
        .where(eq(feedPostsTable.id, post.id));
    }
  }
  console.log(`Inserted ${commentTotal} comments`);

  // Follows: bros follow dolls, some dolls follow back
  let followTotal = 0;
  for (const bro of bros) {
    for (const doll of dolls) {
      if (Math.random() < 0.6) {
        await db
          .insert(followsTable)
          .values({ followerId: bro.id, followingId: doll.id })
          .onConflictDoNothing();
        followTotal++;
      }
    }
  }
  for (const doll of dolls) {
    if (bros[0] && Math.random() < 0.4) {
      await db
        .insert(followsTable)
        .values({ followerId: doll.id, followingId: bros[0].id })
        .onConflictDoNothing();
      followTotal++;
    }
  }
  console.log(`Inserted ${followTotal} follows`);

  // A few notifications for the demo member and first doll
  if (bros[0] && dolls[0]) {
    await db.insert(notificationsTable).values([
      {
        userId: bros[0].id,
        type: "new_follower",
        title: "New follower",
        message: `${dolls[0].name} started following you`,
        relatedUserId: dolls[0].id,
      },
      {
        userId: bros[0].id,
        type: "new_like",
        title: "New like",
        message: `${dolls[1 % dolls.length].name} liked your post`,
        relatedUserId: dolls[1 % dolls.length].id,
        relatedPostId: inserted[1].id,
      },
      {
        userId: dolls[0].id,
        type: "new_comment",
        title: "New comment",
        message: `${bros[0].name} commented on your post`,
        relatedUserId: bros[0].id,
        relatedPostId: inserted[0].id,
      },
    ]);
    console.log("Inserted sample notifications");
  }

  console.log("Feed seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
