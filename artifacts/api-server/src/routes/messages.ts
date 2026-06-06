import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  messageThreadsTable,
  messagesTable,
  dollsTable,
  usersTable,
  creditBalancesTable,
  creditTransactionsTable,
} from "@workspace/db";
import { CreateThreadBody, ListMessagesParams, SendMessageParams, SendMessageBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

const MESSAGE_CREDIT_COST = 1;

async function threadView(thread: typeof messageThreadsTable.$inferSelect) {
  const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, thread.dollId));
  const [member] = await db.select().from(usersTable).where(eq(usersTable.id, thread.memberUserId));
  return {
    id: thread.id,
    dollId: thread.dollId,
    dollName: doll?.stageName ?? "",
    dollPhotoUrl: doll?.profilePhotoUrl ?? "",
    memberId: thread.memberUserId,
    memberName: member?.name ?? "",
    lastMessage: thread.lastMessage ?? "",
    lastMessageAt: thread.lastMessageAt ? thread.lastMessageAt.toISOString() : undefined,
    unreadCount: 0,
  };
}

router.get("/threads", requireAuth("member", "doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rows = await db
    .select()
    .from(messageThreadsTable)
    .where(
      user.role === "doll" && user.dollId
        ? eq(messageThreadsTable.dollId, user.dollId)
        : eq(messageThreadsTable.memberUserId, user.id),
    )
    .orderBy(sql`${messageThreadsTable.lastMessageAt} desc`);
  res.json(await Promise.all(rows.map(threadView)));
});

router.post("/threads", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateThreadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, parsed.data.dollId));
  if (!doll) {
    res.status(404).json({ error: "Doll not found" });
    return;
  }
  const existing = await db
    .select()
    .from(messageThreadsTable)
    .where(
      and(
        eq(messageThreadsTable.memberUserId, user.id),
        eq(messageThreadsTable.dollId, parsed.data.dollId),
      ),
    );
  let thread = existing[0];
  if (!thread) {
    [thread] = await db
      .insert(messageThreadsTable)
      .values({ memberUserId: user.id, dollId: parsed.data.dollId, lastMessage: "" })
      .returning();
  }

  if (parsed.data.message && parsed.data.message.trim().length > 0) {
    const [bal] = await db
      .select()
      .from(creditBalancesTable)
      .where(eq(creditBalancesTable.userId, user.id));
    if (!bal || bal.balance < MESSAGE_CREDIT_COST) {
      res.status(402).json({ error: "Not enough credits to send a message. Please buy credits." });
      return;
    }
    await db
      .update(creditBalancesTable)
      .set({ balance: bal.balance - MESSAGE_CREDIT_COST })
      .where(eq(creditBalancesTable.userId, user.id));
    await db.insert(creditTransactionsTable).values({
      userId: user.id,
      amount: -MESSAGE_CREDIT_COST,
      type: "spend",
      description: `Message to ${doll.stageName}`,
    });
    await db.insert(messagesTable).values({
      threadId: thread.id,
      senderRole: "member",
      senderUserId: user.id,
      body: parsed.data.message,
      paid: true,
    });
    await db
      .update(messageThreadsTable)
      .set({ lastMessage: parsed.data.message, lastMessageAt: new Date() })
      .where(eq(messageThreadsTable.id, thread.id));
    thread.lastMessage = parsed.data.message;
  }

  res.status(201).json(await threadView(thread));
});

router.get("/threads/:id/messages", requireAuth("member", "doll"), async (req, res): Promise<void> => {
  const params = ListMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = req.currentUser!;
  const [thread] = await db
    .select()
    .from(messageThreadsTable)
    .where(eq(messageThreadsTable.id, params.data.id));
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  const allowed =
    (user.role === "member" && thread.memberUserId === user.id) ||
    (user.role === "doll" && thread.dollId === user.dollId);
  if (!allowed) {
    res.status(403).json({ error: "Not your conversation" });
    return;
  }
  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.threadId, thread.id))
    .orderBy(sql`${messagesTable.createdAt} asc`);
  res.json(
    rows.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      senderRole: m.senderRole as "doll" | "member",
      body: m.body,
      paid: m.paid,
      createdAt: m.createdAt ? m.createdAt.toISOString() : undefined,
    })),
  );
});

router.post("/threads/:id/messages", requireAuth("member", "doll"), async (req, res): Promise<void> => {
  const params = SendMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = req.currentUser!;
  const [thread] = await db
    .select()
    .from(messageThreadsTable)
    .where(eq(messageThreadsTable.id, params.data.id));
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  const isMember = user.role === "member" && thread.memberUserId === user.id;
  const isDoll = user.role === "doll" && thread.dollId === user.dollId;
  if (!isMember && !isDoll) {
    res.status(403).json({ error: "Not your conversation" });
    return;
  }

  let paid = false;
  if (isMember) {
    const [bal] = await db
      .select()
      .from(creditBalancesTable)
      .where(eq(creditBalancesTable.userId, user.id));
    if (!bal || bal.balance < MESSAGE_CREDIT_COST) {
      res.status(402).json({ error: "Not enough credits to send a message. Please buy credits." });
      return;
    }
    await db
      .update(creditBalancesTable)
      .set({ balance: bal.balance - MESSAGE_CREDIT_COST })
      .where(eq(creditBalancesTable.userId, user.id));
    await db.insert(creditTransactionsTable).values({
      userId: user.id,
      amount: -MESSAGE_CREDIT_COST,
      type: "spend",
      description: "Sent a message",
    });
    paid = true;
  }

  const [msg] = await db
    .insert(messagesTable)
    .values({
      threadId: thread.id,
      senderRole: user.role === "doll" ? "doll" : "member",
      senderUserId: user.id,
      body: parsed.data.body,
      paid,
    })
    .returning();
  await db
    .update(messageThreadsTable)
    .set({ lastMessage: parsed.data.body, lastMessageAt: new Date() })
    .where(eq(messageThreadsTable.id, thread.id));

  res.status(201).json({
    id: msg.id,
    threadId: msg.threadId,
    senderRole: msg.senderRole as "doll" | "member",
    body: msg.body,
    paid: msg.paid,
    createdAt: msg.createdAt ? msg.createdAt.toISOString() : undefined,
  });
});

export default router;
