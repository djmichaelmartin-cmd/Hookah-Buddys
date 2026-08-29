import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const values = vi.fn(async () => {});
  return { values, insert: vi.fn(() => ({ values })) };
});

vi.mock("@workspace/db", () => ({
  db: { insert: h.insert },
  notificationsTable: { name: "notifications" },
}));

import { createNotification } from "../lib/notify";

it("persists a Spark deep-link relation on notifications", async () => {
  await createNotification({
    userId: 10,
    type: "reel_like",
    title: "New like",
    message: "A user liked your Spark",
    relatedUserId: 11,
    relatedReelId: 72,
  });

  expect(h.insert).toHaveBeenCalledOnce();
  expect(h.values).toHaveBeenCalledWith(
    expect.objectContaining({
      relatedUserId: 11,
      relatedReelId: 72,
    }),
  );
});

it("wires Spark like, comment, and tag notifications to their legacy content id", async () => {
  const source = await readFile(new URL("../routes/reels.ts", import.meta.url), "utf8");
  const relationWires = source.match(/relatedReelId: reel\.id/g) ?? [];

  expect(relationWires).toHaveLength(3);
  expect(source).toMatch(/type: "reel_like"[\s\S]{0,300}relatedReelId: reel\.id/);
  expect(source).toMatch(/type: "reel_comment"[\s\S]{0,300}relatedReelId: reel\.id/);
  expect(source).toMatch(/type: "tag"[\s\S]{0,300}relatedReelId: reel\.id/);
});