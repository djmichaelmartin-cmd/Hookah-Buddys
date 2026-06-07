import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { GetMemberProfileParams } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { toMemberProfileResponse } from "../lib/mappers";

const router: IRouter = Router();

router.get("/members/:id", requireAuth("doll", "admin"), async (req, res): Promise<void> => {
  const params = GetMemberProfileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user || user.role !== "member") {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  res.json(toMemberProfileResponse(user));
});

export default router;
