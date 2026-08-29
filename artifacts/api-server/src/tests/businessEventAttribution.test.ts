import { describe, expect, it } from "vitest";
import {
  canUseBusinessForEvent,
  inheritedEventBusinessId,
  serializeEventBusinessAttribution,
} from "../lib/businessAttribution";

describe("Business Page event attribution", () => {
  it("allows active page roles that can create content", () => {
    expect(canUseBusinessForEvent("active", true, "owner")).toBe(true);
    expect(canUseBusinessForEvent("active", true, "admin")).toBe(true);
    expect(canUseBusinessForEvent("active", true, "editor")).toBe(true);
  });

  it("rejects forged, read-only, inactive, and unpublished page attribution", () => {
    expect(canUseBusinessForEvent("active", true, null)).toBe(false);
    expect(canUseBusinessForEvent("active", true, "analyst")).toBe(false);
    expect(canUseBusinessForEvent("suspended", true, "owner")).toBe(false);
    expect(canUseBusinessForEvent("draft", true, "admin")).toBe(false);
    expect(canUseBusinessForEvent("active", false, "owner")).toBe(false);
  });

  it("serializes stored attribution independently of current page access", () => {
    expect(
      serializeEventBusinessAttribution(42, {
        id: 42,
        name: "Cloud Nine",
        handle: "cloudnine",
        logoUrl: "/objects/cloud-nine-logo",
      }),
    ).toEqual({
      businessId: 42,
      businessName: "Cloud Nine",
      businessHandle: "cloudnine",
      businessLogoUrl: "/objects/cloud-nine-logo",
    });

    // Even if the identity row later disappears, never erase the stored FK.
    expect(serializeEventBusinessAttribution(42, null)).toEqual({
      businessId: 42,
      businessName: null,
      businessHandle: null,
      businessLogoUrl: null,
    });

    expect(inheritedEventBusinessId({ businessId: 42 })).toBe(42);
    expect(inheritedEventBusinessId({ businessId: null })).toBeNull();
  });
});