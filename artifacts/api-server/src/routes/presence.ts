import { Router, type IRouter } from "express";
import { and, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import { db, usersTable, dollsTable, privacySettingsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { loadAudienceSets } from "../lib/socialHelpers";

const router: IRouter = Router();

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

router.post("/presence/heartbeat", requireAuth(), async (req, res): Promise<void> => {
  await db
    .update(usersTable)
    .set({ lastActiveAt: new Date() })
    .where(eq(usersTable.id, req.currentUser!.id));
  res.sendStatus(204);
});

router.get("/presence/online", requireAuth(), async (req, res): Promise<void> => {
  const viewer = req.currentUser!;
  const { blockedEitherWay } = await loadAudienceSets(viewer.id);
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const rows = await db
    .select({
      user: usersTable,
      doll: dollsTable,
    })
    .from(usersTable)
    .leftJoin(privacySettingsTable, eq(privacySettingsTable.userId, usersTable.id))
    .leftJoin(dollsTable, eq(dollsTable.id, usersTable.dollId))
    .where(
      and(
        gt(usersTable.lastActiveAt, cutoff),
        eq(usersTable.accountStatus, "active"),
        // Only Dolls and Bros appear in the Lounge sidebar.
        inArray(usersTable.role, ["doll", "member"]),
        // Dolls only appear once approved.
        or(ne(usersTable.role, "doll"), eq(dollsTable.applicationStatus, "approved")),
        or(isNull(privacySettingsTable.id), ne(privacySettingsTable.showOnlineStatus, "false")),
      ),
    )
    .orderBy(desc(usersTable.lastActiveAt))
    .limit(20);

  const data = rows
    .filter(({ user }) => !blockedEitherWay.has(user.id))
    .map(({ user, doll }) => ({
      id: user.id,
      role: user.role as "doll" | "member" | "admin",
      displayName: user.role === "doll" && doll ? doll.stageName : user.name,
      profilePhotoUrl:
        (user.role === "doll" && doll ? doll.profilePhotoUrl : user.profilePhotoUrl) ?? null,
      city: (user.role === "doll" && doll ? doll.city : user.city) ?? null,
      state: (user.role === "doll" && doll ? doll.state : user.state) ?? null,
      dollId: user.dollId ?? null,
      verified: user.role === "doll" && doll ? doll.verified : false,
      lastActiveAt: (user.lastActiveAt ?? new Date()).toISOString(),
    }));

  res.json(data);
});

export default router;
