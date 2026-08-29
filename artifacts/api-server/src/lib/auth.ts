import type { Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { pool, db, usersTable, subscriptionsTable, plansTable } from "@workspace/db";
import { eq, and, isNull, gt } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      currentUser?: typeof usersTable.$inferSelect;
    }
  }
}

const PgStore = connectPgSimple(session);

export function buildSessionMiddleware() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be set");
  }
  return session({
    store: new PgStore({
      pool,
      createTableIfMissing: false,
      tableName: "user_sessions",
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  });
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function getSessionUser(req: Request) {
  const userId = req.session.userId;
  if (!userId) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user ?? null;
}

export async function hasActivePaidMembership(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(
      and(
        eq(subscriptionsTable.memberUserId, userId),
        eq(subscriptionsTable.status, "active"),
        isNull(subscriptionsTable.dollId),
        eq(plansTable.audience, "member"),
        gt(plansTable.price, 0),
      ),
    )
    .limit(1);
  return !!row;
}

export function requirePaidMember() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.currentUser;
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!(await hasActivePaidMembership(user.id))) {
      res.status(403).json({ error: "A paid membership is required to use this feature" });
      return;
    }
    next();
  };
}

export function requireAuth(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (user.accountStatus === "banned" || user.accountStatus === "suspended") {
      res.status(403).json({ error: "Account is not active" });
      return;
    }
    if (roles.length > 0 && !roles.includes(user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    req.currentUser = user;
    next();
  };
}

/** Blocks creation-only routes until a personal account has chosen a Buddy type. */
