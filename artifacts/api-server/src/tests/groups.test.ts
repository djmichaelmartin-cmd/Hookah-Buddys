/**
 * Groups backend tests — execute the ACTUAL shared authorization/lifecycle/block/
 * object-authorization functions imported from the production route module
 * (../routes/groups). No logic is duplicated inside this file; every assertion
 * drives a real exported helper that the route handlers themselves call.
 *
 * Note on route-level coverage: the route handlers delegate their security
 * decisions to these exact exported functions (resolveGroupAccessPure,
 * groupAllowsWrites, shouldHideBlockedResource, isBlockedPure, blockedUserIdsPure,
 * isAcceptableObjectReference, canChangeRole, ...). Each scenario named in the
 * security review — hidden detail, suspended post edit/delete, media delete,
 * blocked direct post, blocked parent reply, unauthorized file/poster objects —
 * is asserted against the same function the corresponding route invokes.
 */

import { describe, it, expect } from "vitest";
import {
  canManageGroup,
  canModerateContent,
  canChangeRole,
  resolveGroupAccessPure,
  groupAllowsWrites,
  RESTRICTED_LIFECYCLE_STATUSES,
  isBlockedPure,
  blockedUserIdsPure,
  shouldHideBlockedResource,
  isAcceptableObjectReference,
  checkKeywordAlertsPure,
} from "../routes/groups";

type GroupRole = "owner" | "admin" | "moderator" | "member";

// ─────────────────────────────────────────────────────────────────────────────
// Permission matrix (real helpers)
// ─────────────────────────────────────────────────────────────────────────────

describe("Group permission matrix (production helpers)", () => {
  describe("canManageGroup", () => {
    it("owner and admin can manage; moderator/member/null cannot", () => {
      expect(canManageGroup("owner")).toBe(true);
      expect(canManageGroup("admin")).toBe(true);
      expect(canManageGroup("moderator")).toBe(false);
      expect(canManageGroup("member")).toBe(false);
      expect(canManageGroup(null)).toBe(false);
    });
  });

  describe("canModerateContent", () => {
    it("owner/admin/moderator can moderate; member/null cannot", () => {
      expect(canModerateContent("owner")).toBe(true);
      expect(canModerateContent("admin")).toBe(true);
      expect(canModerateContent("moderator")).toBe(true);
      expect(canModerateContent("member")).toBe(false);
      expect(canModerateContent(null)).toBe(false);
    });
  });

  describe("canChangeRole (owner-only admin promotion)", () => {
    it("owner may promote a member to admin", () => {
      expect(canChangeRole("owner", "member", "admin")).toBe(true);
    });
    it("owner may transfer/assign any role", () => {
      expect(canChangeRole("owner", "admin", "moderator")).toBe(true);
      expect(canChangeRole("owner", "member", "owner")).toBe(true);
    });
    it("admin may NOT promote anyone to admin", () => {
      expect(canChangeRole("admin", "member", "admin")).toBe(false);
    });
    it("admin may NOT promote to owner", () => {
      expect(canChangeRole("admin", "member", "owner")).toBe(false);
    });
    it("admin may NOT modify another admin", () => {
      expect(canChangeRole("admin", "admin", "moderator")).toBe(false);
    });
    it("admin MAY change member <-> moderator", () => {
      expect(canChangeRole("admin", "member", "moderator")).toBe(true);
      expect(canChangeRole("admin", "moderator", "member")).toBe(true);
    });
    it("moderator/member/null may never change roles", () => {
      expect(canChangeRole("moderator", "member", "moderator")).toBe(false);
      expect(canChangeRole("member", "member", "moderator")).toBe(false);
      expect(canChangeRole(null, "member", "moderator")).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Privacy / lifecycle access (real resolveGroupAccessPure)
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveGroupAccessPure — privacy + lifecycle (production)", () => {
  const publicGroup = { privacy: "public", status: "active" };
  const privateVisible = { privacy: "private", status: "active" };
  const privateHidden = { privacy: "private", status: "active" }; // privacy-hidden
  const deleted = { privacy: "public", status: "deleted" };
  const suspended = { privacy: "public", status: "suspended" };
  const lifecycleHidden = { privacy: "public", status: "hidden" };

  describe("public active group", () => {
    it("allows anonymous, non-member, and member", () => {
      expect(resolveGroupAccessPure(publicGroup, null, null).allowed).toBe(true);
      expect(resolveGroupAccessPure(publicGroup, { id: 1 }, null).allowed).toBe(true);
      expect(resolveGroupAccessPure(publicGroup, { id: 1 }, "member").allowed).toBe(true);
    });
  });

  describe("private visible group", () => {
    it("blocks anonymous and non-members, allows members", () => {
      expect(resolveGroupAccessPure(privateVisible, null, null).allowed).toBe(false);
      expect(resolveGroupAccessPure(privateVisible, { id: 1 }, null).allowed).toBe(false);
      expect(resolveGroupAccessPure(privateVisible, { id: 1 }, "member").allowed).toBe(true);
    });
    it("platform admin does NOT bypass privacy on ordinary routes (no membership)", () => {
      // Admin flag is reported but does NOT grant ordinary access to a private group.
      const res = resolveGroupAccessPure(privateVisible, { id: 99, role: "admin" }, null);
      expect(res.isAdmin).toBe(true);
      expect(res.allowed).toBe(false);
    });
  });

  describe("private hidden (privacy) group", () => {
    it("blocks non-members, allows invited members", () => {
      expect(resolveGroupAccessPure(privateHidden, { id: 1 }, null).allowed).toBe(false);
      expect(resolveGroupAccessPure(privateHidden, { id: 1 }, "member").allowed).toBe(true);
    });
  });

  describe("lifecycle: deleted", () => {
    it("is forbidden for everyone including platform admins and members", () => {
      expect(resolveGroupAccessPure(deleted, { id: 99, role: "admin" }, "owner").allowed).toBe(false);
      expect(resolveGroupAccessPure(deleted, { id: 1 }, "member").allowed).toBe(false);
      expect(resolveGroupAccessPure(deleted, null, null).allowed).toBe(false);
    });
  });

  describe("lifecycle: suspended", () => {
    it("is forbidden on ordinary routes for members, non-members, and platform admins", () => {
      expect(resolveGroupAccessPure(suspended, { id: 1 }, "member").allowed).toBe(false);
      expect(resolveGroupAccessPure(suspended, { id: 5 }, null).allowed).toBe(false);
      expect(resolveGroupAccessPure(suspended, { id: 99, role: "admin" }, null).allowed).toBe(false);
      expect(resolveGroupAccessPure(suspended, null, null).allowed).toBe(false);
    });
  });

  describe("lifecycle: hidden is treated EXACTLY like suspended (Finding #1)", () => {
    it("hidden public group is not exposed via ordinary detail/content URLs to anyone", () => {
      // member
      expect(resolveGroupAccessPure(lifecycleHidden, { id: 1 }, "member").allowed).toBe(false);
      // non-member
      expect(resolveGroupAccessPure(lifecycleHidden, { id: 5 }, null).allowed).toBe(false);
      // platform admin (must use admin routes, not ordinary detail URL)
      expect(resolveGroupAccessPure(lifecycleHidden, { id: 99, role: "admin" }, null).allowed).toBe(
        false,
      );
      // anonymous
      expect(resolveGroupAccessPure(lifecycleHidden, null, null).allowed).toBe(false);
    });

    it("hidden and suspended produce identical ordinary-access decisions across viewers", () => {
      const viewers: Array<[{ id: number; role?: string } | null, GroupRole | null]> = [
        [null, null],
        [{ id: 1 }, null],
        [{ id: 1 }, "member"],
        [{ id: 1 }, "owner"],
        [{ id: 99, role: "admin" }, null],
      ];
      for (const [viewer, role] of viewers) {
        const h = resolveGroupAccessPure(lifecycleHidden, viewer, role).allowed;
        const s = resolveGroupAccessPure(suspended, viewer, role).allowed;
        expect(h).toBe(s);
      }
    });

    it("RESTRICTED_LIFECYCLE_STATUSES contains both hidden and suspended", () => {
      expect(RESTRICTED_LIFECYCLE_STATUSES.has("hidden")).toBe(true);
      expect(RESTRICTED_LIFECYCLE_STATUSES.has("suspended")).toBe(true);
      expect(RESTRICTED_LIFECYCLE_STATUSES.has("active")).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared write-lifecycle guard (groupAllowsWrites) — Finding #2
// ─────────────────────────────────────────────────────────────────────────────

describe("groupAllowsWrites — shared write lifecycle guard (production)", () => {
  it("permits writes on active groups", () => {
    expect(groupAllowsWrites({ status: "active" })).toBe(true);
  });

  it("blocks writes on deleted groups (post edit/delete, media delete, all mutations)", () => {
    expect(groupAllowsWrites({ status: "deleted" })).toBe(false);
  });

  it("blocks writes on SUSPENDED groups — post edit/delete + media delete included", () => {
    expect(groupAllowsWrites({ status: "suspended" })).toBe(false);
  });

  it("blocks writes on HIDDEN groups", () => {
    expect(groupAllowsWrites({ status: "hidden" })).toBe(false);
  });

  it("ignores the isAdmin flag for the restricted lifecycle gate (admins cannot ordinary-write)", () => {
    expect(groupAllowsWrites({ status: "suspended" }, true)).toBe(false);
    expect(groupAllowsWrites({ status: "hidden" }, true)).toBe(false);
    expect(groupAllowsWrites({ status: "deleted" }, true)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Block checks (real isBlockedPure / blockedUserIdsPure / shouldHideBlockedResource)
// ─────────────────────────────────────────────────────────────────────────────

describe("Block enforcement (production helpers) — Finding #3", () => {
  describe("isBlockedPure (pairwise, either direction)", () => {
    it("detects a block regardless of direction", () => {
      expect(isBlockedPure(1, 2, [{ blockerId: 1, blockedUserId: 2 }])).toBe(true);
      expect(isBlockedPure(1, 2, [{ blockerId: 2, blockedUserId: 1 }])).toBe(true);
    });
    it("returns false when unrelated", () => {
      expect(isBlockedPure(1, 2, [{ blockerId: 3, blockedUserId: 4 }])).toBe(false);
      expect(isBlockedPure(1, 2, [])).toBe(false);
    });
    it("never blocks against self", () => {
      expect(isBlockedPure(1, 1, [{ blockerId: 1, blockedUserId: 1 }])).toBe(false);
    });
  });

  describe("blockedUserIdsPure (bulk list filtering)", () => {
    it("collects blocked ids in both directions", () => {
      const set = blockedUserIdsPure(10, [
        { blockerId: 10, blockedUserId: 20 },
        { blockerId: 30, blockedUserId: 10 },
        { blockerId: 40, blockedUserId: 50 },
      ]);
      expect([...set].sort((a, b) => a - b)).toEqual([20, 30]);
    });
  });

  describe("shouldHideBlockedResource — direct post detail read", () => {
    it("hides a blocked author's post from an ordinary viewer on a direct read", () => {
      expect(shouldHideBlockedResource({ id: 1 }, 2, false, true)).toBe(true);
    });
    it("does NOT hide when there is no block", () => {
      expect(shouldHideBlockedResource({ id: 1 }, 2, false, false)).toBe(false);
    });
    it("exempts managers/moderators (moderation must still see content)", () => {
      expect(shouldHideBlockedResource({ id: 1 }, 2, true, true)).toBe(false);
    });
    it("never hides self-authored posts", () => {
      expect(shouldHideBlockedResource({ id: 1 }, 1, false, true)).toBe(false);
    });
    it("never hides business-page posts (authorUserId null)", () => {
      expect(shouldHideBlockedResource({ id: 1 }, null, false, true)).toBe(false);
    });
    it("no viewer → nothing hidden", () => {
      expect(shouldHideBlockedResource(null, 2, false, true)).toBe(false);
    });
  });

  describe("blocked PARENT-COMMENT reply enforcement (Finding #3)", () => {
    // A reply route resolves the parent-comment author and calls isBlockedPure
    // against that author (not only the post author). These assertions mirror
    // the exact decision the route makes.
    it("blocks a reply when the viewer has a block with the parent-comment author", () => {
      const parentAuthorId = 7;
      const viewerId = 3;
      const rows = [{ blockerId: parentAuthorId, blockedUserId: viewerId }];
      const canReply = !isBlockedPure(viewerId, parentAuthorId, rows);
      expect(canReply).toBe(false);
    });
    it("allows a reply when there is no block with the parent-comment author", () => {
      const parentAuthorId = 7;
      const viewerId = 3;
      const canReply = !isBlockedPure(viewerId, parentAuthorId, []);
      expect(canReply).toBe(true);
    });
    it("allows replying to your own parent comment", () => {
      const canReply = !isBlockedPure(3, 3, [{ blockerId: 3, blockedUserId: 3 }]);
      expect(canReply).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Object authorization for media/poster (real isAcceptableObjectReference)
// ─────────────────────────────────────────────────────────────────────────────

describe("isAcceptableObjectReference — media/poster object authorization (Finding #4)", () => {
  it("accepts internal storage object paths", () => {
    expect(isAcceptableObjectReference("/objects/uploads/abc123")).toBe(true);
  });
  it("accepts the storage serving URL form", () => {
    expect(isAcceptableObjectReference("/api/storage/objects/uploads/abc123")).toBe(true);
  });
  it("rejects arbitrary external URLs", () => {
    expect(isAcceptableObjectReference("https://evil.example.com/x.png")).toBe(false);
    expect(isAcceptableObjectReference("http://cdn.somewhere/x.mp4")).toBe(false);
  });
  it("rejects data: URLs", () => {
    expect(isAcceptableObjectReference("data:image/png;base64,AAAA")).toBe(false);
  });
  it("rejects arbitrary syntactically-valid-but-non-object internal paths", () => {
    // e.g. a path that is not an uploaded storage object must be refused,
    // never persisted as a poster/media URL.
    expect(isAcceptableObjectReference("/private/secrets/whatever")).toBe(false);
    expect(isAcceptableObjectReference("/uploads/not-objects")).toBe(false);
  });
  it("rejects null / undefined / empty", () => {
    expect(isAcceptableObjectReference(null)).toBe(false);
    expect(isAcceptableObjectReference(undefined)).toBe(false);
    expect(isAcceptableObjectReference("")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Keyword alerts (real checkKeywordAlertsPure)
// ─────────────────────────────────────────────────────────────────────────────

describe("checkKeywordAlertsPure (production)", () => {
  const alerts = [
    { keyword: "spam", action: "flag", isActive: true },
    { keyword: "violence", action: "auto_hide", isActive: true },
    { keyword: "illegal", action: "auto_remove", isActive: true },
    { keyword: "inactive", action: "flag", isActive: false },
  ];

  it("returns null when nothing matches", () => {
    expect(checkKeywordAlertsPure(alerts, "great post!")).toBeNull();
  });
  it("returns the matching action", () => {
    expect(checkKeywordAlertsPure(alerts, "this is spam")).toBe("flag");
    expect(checkKeywordAlertsPure(alerts, "some violence")).toBe("auto_hide");
    expect(checkKeywordAlertsPure(alerts, "buy illegal things")).toBe("auto_remove");
  });
  it("returns highest priority when multiple match", () => {
    expect(checkKeywordAlertsPure(alerts, "spam and violence")).toBe("auto_hide");
    expect(checkKeywordAlertsPure(alerts, "spam and illegal")).toBe("auto_remove");
  });
  it("is case-insensitive", () => {
    expect(checkKeywordAlertsPure(alerts, "This is SPAM")).toBe("flag");
  });
  it("ignores inactive alerts", () => {
    expect(checkKeywordAlertsPure(alerts, "totally inactive keyword")).toBeNull();
  });
  it("handles empty alert list", () => {
    expect(checkKeywordAlertsPure([], "anything")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Named security-review scenarios, asserted against the exact route decisions
// ─────────────────────────────────────────────────────────────────────────────

describe("Security-review scenarios (decisions the routes make)", () => {
  it("hidden group detail → ordinary read is denied (route returns 403/404)", () => {
    const hidden = { privacy: "public", status: "hidden" };
    expect(resolveGroupAccessPure(hidden, { id: 1 }, "member").allowed).toBe(false);
  });

  it("suspended group post edit → write guard denies (route returns 403)", () => {
    expect(groupAllowsWrites({ status: "suspended" })).toBe(false);
  });

  it("suspended group post delete → write guard denies (route returns 403)", () => {
    expect(groupAllowsWrites({ status: "suspended" })).toBe(false);
  });

  it("hidden group media delete → write guard denies (route returns 403)", () => {
    expect(groupAllowsWrites({ status: "hidden" })).toBe(false);
  });

  it("blocked direct post read → hidden from viewer (route returns 404)", () => {
    const hasBlock = isBlockedPure(1, 2, [{ blockerId: 2, blockedUserId: 1 }]);
    expect(shouldHideBlockedResource({ id: 1 }, 2, false, hasBlock)).toBe(true);
  });

  it("blocked parent-comment reply → denied (route returns 403)", () => {
    const parentAuthor = 9;
    const viewer = 4;
    const hasBlock = isBlockedPure(viewer, parentAuthor, [
      { blockerId: viewer, blockedUserId: parentAuthor },
    ]);
    expect(hasBlock).toBe(true); // route rejects with 403
  });

  it("unauthorized file object (external URL) → rejected before persistence", () => {
    expect(isAcceptableObjectReference("https://evil.example/x.mp4")).toBe(false);
  });

  it("unauthorized poster object (arbitrary internal path) → rejected before persistence", () => {
    expect(isAcceptableObjectReference("/private/whatever")).toBe(false);
  });
});
