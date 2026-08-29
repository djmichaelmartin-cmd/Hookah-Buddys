import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable, dollsTable, creditBalancesTable, plansTable } from "@workspace/db";
import {
  RegisterDollBody,
  RegisterMemberBody,
  LoginBody,
  GetCurrentUserResponse,
  LogoutResponse,
} from "@workspace/api-zod";
import { hashPassword, verifyPassword, getSessionUser } from "../lib/auth";
import { toUserResponse } from "../lib/mappers";
import { activateMembership } from "../lib/membership";

const router: IRouter = Router();

router.post("/auth/register/doll", async (req, res): Promise<void> => {
  const parsed = RegisterDollBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (!data.ageConfirmed || !data.rulesAccepted) {
    res.status(400).json({ error: "You must confirm you are 21+ and accept the platform rules." });
    return;
  }
  if (data.profilePhotoUrl) {
    res.status(400).json({
      error: "Profile photos cannot be set at registration. Upload one from your profile after signing in.",
    });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, data.email));
  if (existing.length > 0) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  const passwordHash = await hashPassword(data.password);

  const [user] = await db
    .insert(usersTable)
    .values({
      role: "doll",
      name: data.stageName,
      email: data.email,
      passwordHash,
      phone: data.phone,
      city: data.city,
      state: data.state,
      accountStatus: "pending",
      ageConfirmed: data.ageConfirmed,
      rulesAccepted: data.rulesAccepted,
      buddyType: data.buddyType,
    })
    .returning();

  const [doll] = await db
    .insert(dollsTable)
    .values({
      userId: user.id,
      legalName: data.legalName,
      stageName: data.stageName,
      city: data.city,
      state: data.state,
      age: data.age,
      bio: data.bio,
      favoriteFlavor: data.favoriteFlavor,
      experienceLevel: data.experienceLevel,
      preferences: data.preferences,
      verificationPhotoUrl: data.verificationPhotoUrl,
      verificationVideoUrl: data.verificationVideoUrl,
      governmentIdUrl: data.governmentIdUrl,
      tier: "free",
      applicationStatus: "pending",
      subscriptionPrice: 19.99,
      messagePrice: 1.99,
      videoChatRate: 4.99,
    })
    .returning();

  await db.update(usersTable).set({ dollId: doll.id }).where(eq(usersTable.id, user.id));

  req.session.userId = user.id;
  const [refreshed] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  res.status(201).json({ user: toUserResponse(refreshed) });
});

router.post("/auth/register/member", async (req, res): Promise<void> => {
  const parsed = RegisterMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (!data.ageConfirmed || !data.rulesAccepted) {
    res.status(400).json({ error: "You must confirm you are 21+ and accept the platform rules." });
    return;
  }
  if (data.profilePhotoUrl) {
    res.status(400).json({
      error: "Profile photos cannot be set at registration. Upload one from your profile after signing in.",
    });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, data.email));
  if (existing.length > 0) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  const passwordHash = await hashPassword(data.password);

  const [user] = await db
    .insert(usersTable)
    .values({
      role: "member",
      name: data.name,
      email: data.email,
      passwordHash,
      phone: data.phone,
      city: data.city,
      state: data.state,
      username: data.username,
      accountStatus: "active",
      ageConfirmed: data.ageConfirmed,
      rulesAccepted: data.rulesAccepted,
      buddyType: data.buddyType,
    })
    .returning();

  await db.insert(creditBalancesTable).values({ userId: user.id, membershipBalance: 0, purchasedBalance: 0 });

  // Every new member starts on the free Bronze membership. Paid plans are
  // activated after checkout via POST /subscriptions.
  const [bronzePlan] = await db
    .select()
    .from(plansTable)
    .where(and(eq(plansTable.audience, "member"), eq(plansTable.tier, "bronze")));
  if (bronzePlan) {
    await activateMembership(user.id, bronzePlan);
  }

  req.session.userId = user.id;
  res.status(201).json({ user: toUserResponse(user) });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }
  if (user.accountStatus === "banned") {
    res.status(403).json({ error: "This account has been banned." });
    return;
  }

  req.session.userId = user.id;
  await db.update(usersTable).set({ lastActiveAt: new Date() }).where(eq(usersTable.id, user.id));
  res.json({ user: toUserResponse(user) });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await new Promise<void>((resolve) => {
    req.session.destroy(() => resolve());
  });
  res.json(LogoutResponse.parse({ message: "Logged out" }));
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.json(GetCurrentUserResponse.parse({ authenticated: false, user: null }));
    return;
  }
  res.json(GetCurrentUserResponse.parse({ authenticated: true, user: toUserResponse(user) }));
});

export default router;
