import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  videoChatsTable,
  dollsTable,
  usersTable,
  creditTransactionsTable,
} from "@workspace/db";
import { RequestVideoChatBody, EstimateVideoChatQueryParams, VideoChatTokenParams } from "@workspace/api-zod";
import {
  CREDIT_COSTS,
  effectiveVideoMinutes,
  videoChatCreditCost,
} from "@workspace/pricing";
import twilio from "twilio";
import { requireAuth, requirePaidMember } from "../lib/auth";
import { spendCredits } from "../lib/credits";

const router: IRouter = Router();

function videoRoomName(sessionId: number): string {
  return `video-chat-${sessionId}`;
}

function toSession(
  v: typeof videoChatsTable.$inferSelect,
  dollName: string,
  memberName: string,
) {
  return {
    id: v.id,
    dollId: v.dollId,
    dollName,
    memberId: v.memberUserId,
    memberName,
    scheduledAt: v.scheduledAt ? v.scheduledAt.toISOString() : undefined,
    status: v.status as "requested" | "confirmed" | "completed" | "canceled",
    ratePerMinute: v.ratePerMinute,
    durationMinutes: v.durationMinutes,
    createdAt: v.createdAt ? v.createdAt.toISOString() : undefined,
  };
}

router.get("/video-chats", requireAuth("member", "doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rows = await db
    .select({ v: videoChatsTable, dollName: dollsTable.stageName, memberName: usersTable.name })
    .from(videoChatsTable)
    .leftJoin(dollsTable, eq(videoChatsTable.dollId, dollsTable.id))
    .leftJoin(usersTable, eq(videoChatsTable.memberUserId, usersTable.id))
    .where(
      user.role === "doll" && user.dollId
        ? eq(videoChatsTable.dollId, user.dollId)
        : eq(videoChatsTable.memberUserId, user.id),
    )
    .orderBy(sql`${videoChatsTable.createdAt} desc`);
  res.json(rows.map((r) => toSession(r.v, r.dollName ?? "", r.memberName ?? "")));
});

router.get("/video-chats/estimate", requireAuth("member"), async (req, res): Promise<void> => {
  const q = EstimateVideoChatQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const requested = q.data.minutes ?? CREDIT_COSTS.videoMinMinutes;
  const minutes = effectiveVideoMinutes(requested);
  res.json({
    minutes,
    minMinutes: CREDIT_COSTS.videoMinMinutes,
    creditsPerMinute: CREDIT_COSTS.videoPerMinute,
    totalCredits: videoChatCreditCost(requested),
  });
});

router.post("/video-chats", requireAuth("member"), requirePaidMember(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = RequestVideoChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, parsed.data.dollId));
  if (!doll) {
    res.status(404).json({ error: "Doll not found" });
    return;
  }
  // Enforce the 5-minute minimum, then atomically charge credits and create the
  // session + ledger entry in one transaction.
  const minutes = effectiveVideoMinutes(parsed.data.durationMinutes ?? CREDIT_COSTS.videoMinMinutes);
  const cost = videoChatCreditCost(minutes);
  const spend = await spendCredits(user.id, cost, async (tx) => {
    const [created] = await tx
      .insert(videoChatsTable)
      .values({
        memberUserId: user.id,
        dollId: parsed.data.dollId,
        scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
        durationMinutes: minutes,
        ratePerMinute: doll.videoChatRate,
        status: "requested",
      })
      .returning();
    await tx.insert(creditTransactionsTable).values({
      userId: user.id,
      amount: -cost,
      type: "spend",
      description: `Video chat with ${doll.stageName} (${minutes} min)`,
      dollId: doll.id,
      videoChatId: created.id,
    });
    return created;
  });
  if (!spend.ok) {
    res.status(402).json({
      error: `Not enough credits — a ${minutes}-minute video chat costs ${cost} credits. Please buy credits.`,
    });
    return;
  }
  res.status(201).json(toSession(spend.result, doll.stageName, user.name));
});

router.post("/video-chats/:id/token", requireAuth("member", "doll"), async (req, res): Promise<void> => {
  const params = VideoChatTokenParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  if (!accountSid || !apiKeySid || !apiKeySecret) {
    req.log.error("Twilio Video credentials are not configured");
    res.status(503).json({ error: "Video chat is not configured" });
    return;
  }

  const user = req.currentUser!;
  const [session] = await db
    .select()
    .from(videoChatsTable)
    .where(eq(videoChatsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const isMember = user.role === "member" && session.memberUserId === user.id;
  const isDoll = user.role === "doll" && session.dollId === user.dollId;
  if (!isMember && !isDoll) {
    res.status(403).json({ error: "Not your session" });
    return;
  }
  if (session.status === "completed" || session.status === "canceled") {
    res.status(409).json({ error: "This session has ended" });
    return;
  }

  const identity = `${user.role}-${user.id}`;
  const roomName = videoRoomName(session.id);
  const AccessToken = twilio.jwt.AccessToken;
  const VideoGrant = AccessToken.VideoGrant;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: 14400,
  });
  token.addGrant(new VideoGrant({ room: roomName }));

  res.status(201).json({ token: token.toJwt(), roomName, identity });
});

export default router;
