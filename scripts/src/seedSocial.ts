/**
 * Seed the social profile layer: profile details, friendships, albums,
 * photos, and reels. Idempotent: skips sections that already have data.
 * Run: pnpm --filter @workspace/scripts run seed-social
 */
import { sql } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  profileDetailsTable,
  friendshipsTable,
  photoAlbumsTable,
  photosTable,
  reelsTable,
} from "@workspace/db";

async function main() {
  const users = await db.select().from(usersTable);
  const dolls = users.filter((u) => u.role === "doll");
  const bros = users.filter((u) => u.role === "member");
  if (dolls.length === 0 || bros.length === 0) {
    console.log("No seeded users found. Run the main seed first.");
    return;
  }

  const dollImage = (i: number) => `/dolls/doll${(i % 8) + 1}.png`;
  const loungeImage = (i: number) => `/lounge/lounge${(i % 5) + 1}.png`;

  // ---- Profile details ----
  // Per-user upsert-safe (onConflictDoNothing) so partial data doesn't block seeding
  {
    const flavors = ["Double Apple Mint", "Blueberry Ice", "Grape Mint", "Peach Paradise", "Lemon Mint"];
    const vibes = ["Chill and conversational", "Loud music, thick clouds", "Late-night rooftop", "Low lights, slow pulls"];
    const levels = ["beginner", "casual", "enthusiast", "expert"];
    let i = 0;
    for (const u of [...dolls, ...bros]) {
      await db
        .insert(profileDetailsTable)
        .values({
          userId: u.id,
          coverPhotoUrl: loungeImage(i),
          livesInCity: u.city ?? "Atlanta",
          livesInState: u.state ?? "GA",
          description:
            u.role === "doll"
              ? "Hookah lounge regular and cloud connoisseur. Catch me where the coals are perfect."
              : "Here for good smoke, good music, and better company.",
          favoriteHookahFlavor: flavors[i % flavors.length],
          favoriteHookahLounge: "Cloud Nine Lounge",
          favoriteHookahBrand: "Khalil Mamoon",
          hookahExperienceLevel: levels[i % levels.length],
          favoriteSmokeSessionVibe: vibes[i % vibes.length],
          openToLoungeMeetups: u.role === "member" ? "yes" : "sometimes",
          favoriteLoungeCity: u.city ?? "Atlanta",
          interests: JSON.stringify(["Hookah", "Lounges", "Music", "Nightlife"].slice(0, 2 + (i % 3))),
        })
        .onConflictDoNothing();
      i++;
    }
    console.log(`Seeded profile details for ${i} users`);
  }

  // ---- Friendships ----
  const [friendCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(friendshipsTable);
  if (friendCount.c === 0) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < Math.min(bros.length, 2); i++) {
      for (let j = 0; j < Math.min(dolls.length, 3); j++) {
        pairs.push([bros[i].id, dolls[j].id]);
      }
    }
    if (bros.length >= 2) pairs.push([bros[0].id, bros[1].id]);
    for (const [x, y] of pairs) {
      const [a, b] = x < y ? [x, y] : [y, x];
      await db.insert(friendshipsTable).values({ userAId: a, userBId: b }).onConflictDoNothing();
    }
    console.log(`Seeded ${pairs.length} friendships`);
  } else {
    console.log("Friendships already seeded. Skipping.");
  }

  // ---- Albums & photos ----
  const [albumCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(photoAlbumsTable);
  if (albumCount.c === 0) {
    let photoTotal = 0;
    const subjects = [...dolls.slice(0, 4), ...bros.slice(0, 2)];
    for (let i = 0; i < subjects.length; i++) {
      const u = subjects[i];
      const [setupAlbum] = await db
        .insert(photoAlbumsTable)
        .values({ userId: u.id, title: "Hookah Setups", albumType: "hookah_setups", visibility: "public" })
        .returning();
      const [nightsAlbum] = await db
        .insert(photoAlbumsTable)
        .values({ userId: u.id, title: "Lounge Nights", albumType: "lounge_nights", visibility: "public" })
        .returning();
      for (let k = 0; k < 3; k++) {
        await db.insert(photosTable).values({
          userId: u.id,
          albumId: k % 2 === 0 ? setupAlbum.id : nightsAlbum.id,
          imageUrl: k % 2 === 0 ? dollImage(i + k) : loungeImage(i + k),
          caption: k % 2 === 0 ? "Tonight's setup, dialed in." : "Lounge night with the crew.",
          visibility: "public",
        });
        photoTotal++;
      }
    }
    console.log(`Seeded ${subjects.length * 2} albums and ${photoTotal} photos`);
  } else {
    console.log("Albums already seeded. Skipping.");
  }

  // ---- Reels ----
  const [reelCount] = await db.select({ c: sql<number>`count(*)::int` }).from(reelsTable);
  if (reelCount.c === 0) {
    const reelSeeds = [
      { user: dolls[0], category: "hookah_setup", caption: "Packing the perfect bowl in 30 seconds", hashtags: ["setup", "cloudcheck"] },
      { user: dolls[1 % dolls.length], category: "lounge_night", caption: "Saturday night at Cloud Nine", hashtags: ["loungenight"] },
      { user: bros[0], category: "flavor_review", caption: "Rating this blueberry ice mix", hashtags: ["flavorreview", "blueberry"] },
      { user: dolls[2 % dolls.length], category: "smoke_tricks", caption: "Triple ring challenge", hashtags: ["smoketricks"] },
      { user: bros[1 % bros.length], category: "tutorial", caption: "How I manage my coals for a 2-hour session", hashtags: ["tutorial", "coals"] },
    ];
    for (let i = 0; i < reelSeeds.length; i++) {
      const r = reelSeeds[i];
      await db.insert(reelsTable).values({
        userId: r.user.id,
        userRole: r.user.role,
        videoUrl: loungeImage(i),
        thumbnailUrl: dollImage(i),
        caption: r.caption,
        category: r.category,
        hashtags: JSON.stringify(r.hashtags),
        visibility: "public",
        isHookahRelatedConfirmed: true,
        viewCount: 40 + i * 23,
        likeCount: 5 + i * 3,
      });
    }
    console.log(`Seeded ${reelSeeds.length} reels`);
  } else {
    console.log("Reels already seeded. Skipping.");
  }

  console.log("Social seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
