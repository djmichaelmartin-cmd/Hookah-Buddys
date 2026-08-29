import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  messageThreadsTable,
  messagesTable,
  dollsTable,
  usersTable,
  creditTransactionsTable,
} from "@workspace/db";
import { CreateThreadBody, ListMessagesParams, SendMessageParams, SendMessageBody } from "@workspace/api-zod";
import { messageCreditCost } from "@workspace/pricing";
import { requireAuth, hasActivePaidMembership } from "../lib/auth";
import { spendCredits } from "../lib/credits";

const router: IRouter = Router();

async function threadMessageCount(threadId: number): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(messagesTable)
    .where(eq(messagesTable.threadId, threadId));
  return count;
}

async function threadView(thread: typeof messageThreadsTable.$inferSelect) {
  const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, thread.dollId));
  const [member] = await db.select().from(usersTable).where(eq(usersTable.id, thread.memberUserId));
  const [dollUser] = doll
    ? await db.select().from(usersTable).where(eq(usersTable.id, doll.userId))
    : [];
  return {
    id: thread.id,
    dollId: thread.dollId,
    dollName: doll?.stageName ?? "",
    dollPhotoUrl: doll?.profilePhotoUrl ?? "",
    dollBuddyType: dollUser?.buddyType ?? null,
    memberId: thread.memberUserId,
    memberName: member?.name ?? "",
    memberBuddyType: member?.buddyType ?? null,
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

router.post("/threads", requireAuth("member", "doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateThreadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Doll initiating a conversation with a member — free, no credits charged.
  if (user.role === "doll") {
    if (!user.dollId) {
      res.status(404).json({ error: "Buddy profile not found" });
      return;
    }
    if (!parsed.data.memberId) {
      res.status(400).json({ error: "memberId is required" });
      return;
    }
    const [member] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, parsed.data.memberId));
    if (!member || member.role !== "member" || member.accountStatus !== "active") {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    const existingDollThread = await db
      .select()
      .from(messageThreadsTable)
      .where(
        and(
          eq(messageThreadsTable.memberUserId, member.id),
          eq(messageThreadsTable.dollId, user.dollId),
        ),
      );
    let dollThread = existingDollThread[0];
    if (!dollThread) {
      [dollThread] = await db
        .insert(messageThreadsTable)
        .values({ memberUserId: member.id, dollId: user.dollId, lastMessage: "" })
        .returning();
    }

    if (parsed.data.message && parsed.data.message.trim().length > 0) {
      const messageBody = parsed.data.message;
      await db.insert(messagesTable).values({
        threadId: dollThread.id,
        senderRole: "doll",
        senderUserId: user.id,
        body: messageBody,
        paid: false,
      });
      await db
        .update(messageThreadsTable)
        .set({ lastMessage: messageBody, lastMessageAt: new Date() })
        .where(eq(messageThreadsTable.id, dollThread.id));
      dollThread.lastMessage = messageBody;
    }

    res.status(201).json(await threadView(dollThread));
    return;
  }

  // Member initiating with a Doll — requires a paid membership and costs credits.
  if (!(await hasActivePaidMembership(user.id))) {
    res.status(403).json({ error: "A paid membership is required to use this feature" });
    return;
  }
  if (!parsed.data.dollId) {
    res.status(400).json({ error: "dollId is required" });
    return;
  }
  const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, parsed.data.dollId));
  if (!doll) {
    res.status(404).json({ error: "Buddy not found" });
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
    const messageBody = parsed.data.message;
    const existingCount = await threadMessageCount(thread.id);
    const cost = messageCreditCost(existingCount === 0);
    // Atomically debit credits and persist the message + ledger entry together.
    const spend = await spendCredits(user.id, cost, async (tx) => {
      await tx.insert(messagesTable).values({
        threadId: thread.id,
        senderRole: "member",
        senderUserId: user.id,
        body: messageBody,
        paid: true,
      });
      await tx.insert(creditTransactionsTable).values({
        userId: user.id,
        amount: -cost,
        type: "spend",
        description: `${existingCount === 0 ? "Started conversation with" : "Message to"} ${doll.stageName}`,
        dollId: doll.id,
      });
      await tx
        .update(messageThreadsTable)
        .set({ lastMessage: messageBody, lastMessageAt: new Date() })
        .where(eq(messageThreadsTable.id, thread.id));
    });
    if (!spend.ok) {
      res.status(402).json({ error: `Not enough credits — sending this message costs ${cost} credits. Please buy credits.` });
      return;
    }
    thread.lastMessage = messageBody;
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

  const senderRole = user.role === "doll" ? "doll" : "member";
  const messageBody = parsed.data.body;

  // Doll replies are free; member messages are charged atomically together with
  // persisting the message, ledger entry, and thread preview.
  if (isMember) {
    const existingCount = await threadMessageCount(thread.id);
    const cost = messageCreditCost(existingCount === 0);
    const spend = await spendCredits(user.id, cost, async (tx) => {
      const [created] = await tx
        .insert(messagesTable)
        .values({
          threadId: thread.id,
          senderRole,
          senderUserId: user.id,
          body: messageBody,
          paid: true,
        })
        .returning();
      await tx.insert(creditTransactionsTable).values({
        userId: user.id,
        amount: -cost,
        type: "spend",
        description: existingCount === 0 ? "Started a conversation" : "Sent a message",
        dollId: thread.dollId,
        messageId: created.id,
      });
      await tx
        .update(messageThreadsTable)
        .set({ lastMessage: messageBody, lastMessageAt: new Date() })
        .where(eq(messageThreadsTable.id, thread.id));
      return created;
    });
    if (!spend.ok) {
      res.status(402).json({ error: `Not enough credits — sending this message costs ${cost} credits. Please buy credits.` });
      return;
    }
    const msg = spend.result;
    res.status(201).json({
      id: msg.id,
      threadId: msg.threadId,
      senderRole: msg.senderRole as "doll" | "member",
      body: msg.body,
      paid: msg.paid,
      createdAt: msg.createdAt ? msg.createdAt.toISOString() : undefined,
    });
    return;
  }

  const [msg] = await db
    .insert(messagesTable)
    .values({
      threadId: thread.id,
      senderRole,
      senderUserId: user.id,
      body: messageBody,
      paid: false,
    })
    .returning();
  await db
    .update(messageThreadsTable)
    .set({ lastMessage: messageBody, lastMessageAt: new Date() })
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
