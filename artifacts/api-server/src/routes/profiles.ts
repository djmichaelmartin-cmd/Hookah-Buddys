import { Router, type IRouter } from "express";
import { and, eq, or, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  dollsTable,
  feedPostsTable,
  photosTable,
  reelsTable,
  followsTable,
  friendshipsTable,
  friendRequestsTable,
  profileDetailsTable,
  profileFieldPrivacyTable,
  privacySettingsTable,
  profileViewsTable,
} from "@workspace/db";
import { UpdateMyProfileBody, UpdatePrivacySettingsBody } from "@workspace/api-zod";
import { requireAuth, getSessionUser } from "../lib/auth";
import {
  getRelationship,
  filterDetailsForViewer,
  detailsToResponse,
  getProfileDetails,
  getFieldPrivacy,
  getOrCreatePrivacySettings,
  privacySettingsToResponse,
  canView,
  friendPair,
  PROFILE_DETAIL_FIELDS,
  type Relationship,
} from "../lib/socialHelpers";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

async function countFriends(userId: number): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(friendshipsTable)
    .where(or(eq(friendshipsTable.userAId, userId), eq(friendshipsTable.userBId, userId)));
  return row.c;
}

async function mutualFriendIds(a: number, b: number): Promise<number[]> {
  const friendsOf = async (id: number) => {
    const rows = await db
      .select()
      .from(friendshipsTable)
      .where(or(eq(friendshipsTable.userAId, id), eq(friendshipsTable.userBId, id)));
    return new Set(rows.map((r) => (r.userAId === id ? r.userBId : r.userAId)));
  };
  const [fa, fb] = await Promise.all([friendsOf(a), friendsOf(b)]);
  return [...fa].filter((id) => fb.has(id));
}

export async function buildEnhancedProfile(
  targetUserId: number,
  viewer: { id: number; role: string } | null,
  forcePublic = false,
) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
  if (!user || user.accountStatus === "banned") return null;

  const effectiveViewer = forcePublic ? null : viewer;
  const rel = await getRelationship(effectiveViewer, targetUserId);
  if ((rel.targetBlockedViewer || rel.viewerBlockedTarget) && !rel.isAdmin && !rel.isSelf) return null;

  const details = detailsToResponse(await getProfileDetails(targetUserId));
  const privacyRows = await getFieldPrivacy(targetUserId);
  const filteredDetails = filterDetailsForViewer(details, privacyRows, rel);

  let dollVerified = false;
  if (user.dollId != null) {
    const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, user.dollId));
    dollVerified = doll?.verified ?? false;
  }

  const [followerRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(followsTable)
    .where(eq(followsTable.followingId, targetUserId));
  const [followingRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(followsTable)
    .where(eq(followsTable.followerId, targetUserId));
  const friendCount = await countFriends(targetUserId);
  const [postRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(feedPostsTable)
    .where(and(eq(feedPostsTable.userId, targetUserId), eq(feedPostsTable.status, "active")));
  const [photoRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(photosTable)
    .where(and(eq(photosTable.userId, targetUserId), eq(photosTable.status, "active")));
  const [reelRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(reelsTable)
    .where(and(eq(reelsTable.userId, targetUserId), eq(reelsTable.status, "active")));

  // Friend status from viewer's perspective
  let friendStatus = "none";
  let pendingRequestId: number | null = null;
  if (rel.isSelf) {
    friendStatus = "self";
  } else if (rel.viewerBlockedTarget) {
    friendStatus = "blocked";
  } else if (rel.isFriend) {
    friendStatus = "friends";
  } else if (effectiveViewer) {
    const [req] = await db
      .select()
      .from(friendRequestsTable)
      .where(
        and(
          eq(friendRequestsTable.status, "pending"),
          or(
            and(
              eq(friendRequestsTable.senderId, effectiveViewer.id),
              eq(friendRequestsTable.receiverId, targetUserId),
            ),
            and(
              eq(friendRequestsTable.senderId, targetUserId),
              eq(friendRequestsTable.receiverId, effectiveViewer.id),
            ),
          ),
        ),
      );
    if (req) {
      friendStatus = req.senderId === effectiveViewer.id ? "pending_sent" : "pending_received";
      pendingRequestId = req.id;
    }
  }

  const settings = await getOrCreatePrivacySettings(targetUserId);
  const canViewFriends = rel.isSelf || rel.isAdmin || canView(settings.showFriendsList, rel);

  let mutualFriendCount = 0;
  if (effectiveViewer && !rel.isSelf) {
    mutualFriendCount = (await mutualFriendIds(effectiveViewer.id, targetUserId)).length;
  }

  const badges: string[] = [];
  if (user.role === "doll" && dollVerified) badges.push("verified_doll");
  if (user.role === "member") {
    if (user.accountStatus === "active" && user.ageConfirmed) badges.push("verified_bro");
    if (followerRow.c >= 5) badges.push("vip_bro");
    if (postRow.c >= 10) badges.push("top_supporter");
  }

  return {
    userId: user.id,
    name: user.name,
    username: user.username ?? null,
    role: user.role,
    verified: dollVerified,
    dollId: user.dollId ?? null,
    profilePhotoUrl: user.profilePhotoUrl ?? null,
    coverPhotoUrl: details.coverPhotoUrl,
    city: user.city ?? filteredDetails.livesInCity,
    state: user.state ?? filteredDetails.livesInState,
    memberSince: user.createdAt.toISOString(),
    badges,
    followerCount: followerRow.c,
    followingCount: followingRow.c,
    friendCount,
    postCount: postRow.c,
    photoCount: photoRow.c,
    reelCount: reelRow.c,
    friendStatus,
    pendingRequestId,
    viewerFollows: rel.isFollower,
    viewerBlocked: rel.viewerBlockedTarget,
    mutualFriendCount,
    canViewFriends,
    details: filteredDetails,
  };
}

router.get("/profiles/me", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  res.json(await buildMyProfileData(user.id));
});

async function buildMyProfileData(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const details = detailsToResponse(await getProfileDetails(userId));
  const privacyRows = await getFieldPrivacy(userId);

  const [postRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(feedPostsTable)
    .where(and(eq(feedPostsTable.userId, userId), eq(feedPostsTable.status, "active")));
  const [reelRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(reelsTable)
    .where(and(eq(reelsTable.userId, userId), eq(reelsTable.status, "active")));

  const checklist: [string, boolean][] = [
    ["profilePhoto", !!user?.profilePhotoUrl],
    ["coverPhoto", !!details.coverPhotoUrl],
    ["cityState", !!(user?.city || details.livesInCity)],
    ["bio", !!details.description],
    ["favoriteHookahFlavor", !!details.favoriteHookahFlavor],
    ["interests", details.interests.length > 0],
    ["firstPost", postRow.c > 0],
    ["firstReel", reelRow.c > 0],
  ];
  const done = checklist.filter(([, ok]) => ok).length;

  return {
    userId,
    name: user?.name ?? "",
    username: user?.username ?? null,
    profilePhotoUrl: user?.profilePhotoUrl ?? null,
    details,
    fieldPrivacy: privacyRows.map((r) => ({ fieldName: r.fieldName, visibility: r.visibility })),
    profileCompletion: {
      percent: Math.round((done / checklist.length) * 100),
      missing: checklist.filter(([, ok]) => !ok).map(([name]) => name),
    },
  };
}

router.put("/profiles/me", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = UpdateMyProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;

  // User row updates
  const userUpdates: Record<string, unknown> = {};
  if (input.name !== undefined && input.name.trim()) userUpdates.name = input.name.trim();
  if (input.username !== undefined) {
    const uname = input.username.trim().toLowerCase();
    if (uname) {
      const [taken] = await db
        .select()
        .from(usersTable)
        .where(and(eq(usersTable.username, uname), sql`${usersTable.id} != ${user.id}`));
      if (taken) {
        res.status(400).json({ error: "Username is already taken" });
        return;
      }
      userUpdates.username = uname;
    }
  }
  if (input.profilePhotoUrl !== undefined) userUpdates.profilePhotoUrl = input.profilePhotoUrl;
  if (Object.keys(userUpdates).length > 0) {
    await db.update(usersTable).set(userUpdates).where(eq(usersTable.id, user.id));
  }

  // Details upsert
  if (input.details) {
    const d = input.details;
    const detailValues = {
      userId: user.id,
      coverPhotoUrl: d.coverPhotoUrl ?? null,
      livesInCity: d.livesInCity ?? null,
      livesInState: d.livesInState ?? null,
      fromCity: d.fromCity ?? null,
      fromState: d.fromState ?? null,
      birthMonth: d.birthMonth ?? null,
      birthDay: d.birthDay ?? null,
      birthYear: d.birthYear ?? null,
      gender: d.gender ?? null,
      languagesSpoken: d.languagesSpoken ?? null,
      hairColor: d.hairColor ?? null,
      eyeColor: d.eyeColor ?? null,
      ethnicity: d.ethnicity ?? null,
      bodyType: d.bodyType ?? null,
      height: d.height ?? null,
      relationshipStatus: d.relationshipStatus ?? null,
      occupation: d.occupation ?? null,
      education: d.education ?? null,
      description: d.description ?? null,
      websiteUrl: d.websiteUrl ?? null,
      socialLinks: d.socialLinks ? JSON.stringify(d.socialLinks) : null,
      favoriteHookahFlavor: d.favoriteHookahFlavor ?? null,
      favoriteHookahLounge: d.favoriteHookahLounge ?? null,
      favoriteHookahBrand: d.favoriteHookahBrand ?? null,
      favoriteHookahSetup: d.favoriteHookahSetup ?? null,
      hookahExperienceLevel: d.hookahExperienceLevel ?? null,
      preferredHookahStyle: d.preferredHookahStyle ?? null,
      favoriteSmokeSessionVibe: d.favoriteSmokeSessionVibe ?? null,
      favoriteHookahAccessories: d.favoriteHookahAccessories ?? null,
      openToLoungeMeetups: d.openToLoungeMeetups ?? null,
      favoriteLoungeCity: d.favoriteLoungeCity ?? null,
      interests: d.interests ? JSON.stringify(d.interests) : null,
    };
    const { userId: _u, ...updateValues } = detailValues;
    await db
      .insert(profileDetailsTable)
      .values(detailValues)
      .onConflictDoUpdate({ target: profileDetailsTable.userId, set: updateValues });
    // Keep users.city/state in sync with livesIn for existing UI surfaces
    if (d.livesInCity !== undefined || d.livesInState !== undefined) {
      await db
        .update(usersTable)
        .set({ city: d.livesInCity ?? null, state: d.livesInState ?? null })
        .where(eq(usersTable.id, user.id));
    }
  }

  // Field privacy upserts
  if (input.fieldPrivacy) {
    const allowed = new Set<string>(PROFILE_DETAIL_FIELDS);
    for (const fp of input.fieldPrivacy) {
      if (!allowed.has(fp.fieldName)) continue;
      await db
        .insert(profileFieldPrivacyTable)
        .values({ userId: user.id, fieldName: fp.fieldName, visibility: fp.visibility })
        .onConflictDoUpdate({
          target: [profileFieldPrivacyTable.userId, profileFieldPrivacyTable.fieldName],
          set: { visibility: fp.visibility },
        });
    }
  }

  res.json(await buildMyProfileData(user.id));
});

router.get("/profiles/:userId", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const userId = parseId(req.params.userId);
  const profile = await buildEnhancedProfile(userId, viewer ?? null);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(profile);
});

router.get("/profiles/:userId/public", async (req, res): Promise<void> => {
  const userId = parseId(req.params.userId);
  const profile = await buildEnhancedProfile(userId, null, true);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(profile);
});

router.post("/profiles/:userId/view", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const userId = parseId(req.params.userId);
  if (!Number.isNaN(userId) && viewer?.id !== userId) {
    await db.insert(profileViewsTable).values({ viewerId: viewer?.id ?? null, viewedUserId: userId });
  }
  res.sendStatus(204);
});

router.get("/settings/privacy", requireAuth(), async (req, res): Promise<void> => {
  const settings = await getOrCreatePrivacySettings(req.currentUser!.id);
  res.json(privacySettingsToResponse(settings));
});

router.put("/settings/privacy", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = UpdatePrivacySettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await getOrCreatePrivacySettings(user.id);
  const input = parsed.data;
  const updates: Record<string, unknown> = {};
  if (input.defaultPostAudience !== undefined) updates.defaultPostAudience = input.defaultPostAudience;
  if (input.showFriendsList !== undefined) updates.showFriendsList = input.showFriendsList;
  if (input.showFollowersList !== undefined) updates.showFollowersList = input.showFollowersList;
  if (input.allowFriendRequestsFrom !== undefined) updates.allowFriendRequestsFrom = input.allowFriendRequestsFrom;
  if (input.allowMessagesFrom !== undefined) updates.allowMessagesFrom = input.allowMessagesFrom;
  if (input.allowTagging !== undefined) updates.allowTagging = input.allowTagging;
  if (input.requireTagReview !== undefined) updates.requireTagReview = String(input.requireTagReview);
  if (input.allowSearchByEmail !== undefined) updates.allowSearchByEmail = input.allowSearchByEmail;
  if (input.allowSearchByPhone !== undefined) updates.allowSearchByPhone = input.allowSearchByPhone;
  if (input.allowExternalSearchIndexing !== undefined)
    updates.allowExternalSearchIndexing = String(input.allowExternalSearchIndexing);
  if (Object.keys(updates).length > 0) {
    await db.update(privacySettingsTable).set(updates).where(eq(privacySettingsTable.userId, user.id));
  }
  const settings = await getOrCreatePrivacySettings(user.id);
  res.json(privacySettingsToResponse(settings));
});

export default router;
