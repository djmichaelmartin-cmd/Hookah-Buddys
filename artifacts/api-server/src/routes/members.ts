import { Router, type IRouter } from "express";
import { eq, and, or, ilike, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { GetMemberProfileParams, ListMembersQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { toMemberProfileResponse } from "../lib/mappers";

const router: IRouter = Router();

router.get("/members", requireAuth("doll", "admin"), async (req, res): Promise<void> => {
  const parsed = ListMembersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const q = parsed.data;
  const conditions = [eq(usersTable.role, "member"), eq(usersTable.accountStatus, "active")];
  if (q.city) conditions.push(ilike(usersTable.city, `%${q.city}%`));
  if (q.state) conditions.push(ilike(usersTable.state, `%${q.state}%`));
  if (q.search) {
    const term = `%${q.search}%`;
    const match = or(ilike(usersTable.name, term), ilike(usersTable.username, term));
    if (match) conditions.push(match);
  }

  const rows = await db
    .select()
    .from(usersTable)
    .where(and(...conditions))
    .orderBy(sql`${usersTable.createdAt} desc`);

  res.json(rows.map((u) => toMemberProfileResponse(u)));
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
