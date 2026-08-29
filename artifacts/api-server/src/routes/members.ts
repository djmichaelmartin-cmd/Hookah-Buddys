import { Router, type IRouter } from "express";
import { eq, and, or } from "drizzle-orm";
import { blocksTable, db, dollsTable, usersTable } from "@workspace/db";
import { GetMemberProfileParams, ListMembersQueryParams } from "@workspace/api-zod";
import { getSessionUser, requireAuth } from "../lib/auth";
import { toMemberProfileResponse } from "../lib/mappers";
import { buildBuddyDiscoveryProfiles } from "../lib/memberDiscovery";

const router: IRouter = Router();

router.get("/members", async (req, res): Promise<void> => {
  for (const key of ["minAge", "maxAge"] as const) {
    const raw = req.query[key];
    if (raw !== undefined) {
      const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
      if (!Number.isInteger(value) || value < 18 || value > 120) {
        res.status(400).json({ error: `${key} must be a whole number between 18 and 120` });
        return;
      }
    }
  }
  const parsed = ListMembersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const q = parsed.data;
  if (q.minAge !== undefined && q.maxAge !== undefined && q.minAge > q.maxAge) {
    res.status(400).json({ error: "minAge must be less than or equal to maxAge" });
    return;
  }

  const userFields = {
    id: usersTable.id,
    name: usersTable.name,
    username: usersTable.username,
    city: usersTable.city,
    state: usersTable.state,
    profilePhotoUrl: usersTable.profilePhotoUrl,
    buddyType: usersTable.buddyType,
    createdAt: usersTable.createdAt,
  };
  const [memberRows, dollRows] = await Promise.all([
    db
      .select(userFields)
      .from(usersTable)
      .where(and(eq(usersTable.role, "member"), eq(usersTable.accountStatus, "active"))),
    db
      .select({
        ...userFields,
        dollId: dollsTable.id,
        stageName: dollsTable.stageName,
        dollAge: dollsTable.age,
        dollCity: dollsTable.city,
        dollState: dollsTable.state,
        dollProfilePhotoUrl: dollsTable.profilePhotoUrl,
      })
      .from(usersTable)
      .innerJoin(dollsTable, eq(dollsTable.userId, usersTable.id))
      .where(
        and(
          eq(usersTable.role, "doll"),
          eq(usersTable.accountStatus, "active"),
          eq(dollsTable.applicationStatus, "approved"),
        ),
      ),
  ]);

  const viewer = await getSessionUser(req);
  let blockedIds = new Set<number>();
  if (viewer) {
    const blockRows = await db
      .select({ blockerId: blocksTable.blockerId, blockedUserId: blocksTable.blockedUserId })
      .from(blocksTable)
      .where(or(eq(blocksTable.blockerId, viewer.id), eq(blocksTable.blockedUserId, viewer.id)));
    blockedIds = new Set(
      blockRows.map((block) =>
        block.blockerId === viewer.id ? block.blockedUserId : block.blockerId,
      ),
    );
  }
  res.json(buildBuddyDiscoveryProfiles(memberRows, dollRows, q, blockedIds));
});

router.get("/members/:id", requireAuth("doll", "admin"), async (req, res): Promise<void> => {
  const params = GetMemberProfileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user || user.role !== "member" || user.accountStatus !== "active") {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  res.json(toMemberProfileResponse(user));
});

export default router;
