import { Router, type IRouter } from "express";
import { db, contactMessagesTable } from "@workspace/db";
import { SubmitContactBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/contact", async (req, res): Promise<void> => {
  const parsed = SubmitContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db.insert(contactMessagesTable).values({
    name: parsed.data.name,
    email: parsed.data.email,
    accountType: parsed.data.accountType,
    category: parsed.data.category,
    message: parsed.data.message,
    screenshotUrl: parsed.data.screenshotUrl,
  });
  res.status(201).json({ message: "Thanks for reaching out. Our team will respond within 24 hours." });
});

export default router;
