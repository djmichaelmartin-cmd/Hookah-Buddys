import type { Request, Response, NextFunction } from "express";

/**
 * Blocks creation-only routes until a personal account has chosen a Buddy type.
 * Kept separate from auth so focused route tests can mock authentication without
 * replacing this production middleware.
 */
export function requireCompleteBuddyProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.currentUser;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if ((user.role === "member" || user.role === "doll") && user.buddyType == null) {
    res.status(403).json({
      error: "Choose your Buddy type in your profile before creating content.",
      code: "BUDDY_TYPE_REQUIRED",
    });
    return;
  }
  next();
}