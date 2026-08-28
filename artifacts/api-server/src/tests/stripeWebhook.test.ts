import type { Request } from "express";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rows = [{ memberUserId: 314 }];
  const eqMock = vi.fn((_column: unknown, value: unknown) => ({ value }));
  const limitMock = vi.fn(async () => rows);
  const whereMock = vi.fn(() => ({ limit: limitMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  const renewMembershipMock = vi.fn(async () => ({
    plan: { name: "Silver", monthlyCredits: 50 },
  }));

  return {
    rows,
    eqMock,
    limitMock,
    whereMock,
    fromMock,
    selectMock,
    renewMembershipMock,
  };
});

vi.mock("drizzle-orm", () => ({
  eq: h.eqMock,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: h.selectMock,
  },
  subscriptionsTable: {
    id: "id",
    memberUserId: "memberUserId",
    stripeSubscriptionId: "stripeSubscriptionId",
    stripeCheckoutSessionId: "stripeCheckoutSessionId",
  },
  plansTable: {},
  creditPackagesTable: {},
}));

vi.mock("../lib/membership", () => ({
  activateMembership: vi.fn(),
  renewMembership: h.renewMembershipMock,
}));

vi.mock("../lib/credits", () => ({
  grantCredits: vi.fn(),
}));

vi.mock("../lib/stripe", () => ({
  getStripeClient: vi.fn(),
}));

import {
  handleInvoicePaymentSucceeded,
  resolveInvoiceSubscriptionId,
} from "../routes/webhooks";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Request["log"];

function invoice(payload: Record<string, unknown>): Stripe.Invoice {
  return {
    id: "in_test",
    object: "invoice",
    ...payload,
  } as unknown as Stripe.Invoice;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.splice(0, h.rows.length, { memberUserId: 314 });
});

describe("Stripe invoice subscription compatibility", () => {
  it("renews memberships from the current parent subscription field", async () => {
    const currentInvoice = invoice({
      parent: {
        type: "subscription_details",
        subscription_details: {
          subscription: "sub_current",
          metadata: {},
        },
      },
    });

    expect(resolveInvoiceSubscriptionId(currentInvoice)).toBe("sub_current");

    await handleInvoicePaymentSucceeded(currentInvoice, log);

    expect(h.eqMock).toHaveBeenCalledWith("stripeSubscriptionId", "sub_current");
    expect(h.renewMembershipMock).toHaveBeenCalledOnce();
    expect(h.renewMembershipMock).toHaveBeenCalledWith(314);
  });

  it("renews memberships from the legacy top-level subscription field", async () => {
    const legacyInvoice = invoice({
      subscription: {
        id: "sub_legacy",
        object: "subscription",
      },
    });

    expect(resolveInvoiceSubscriptionId(legacyInvoice)).toBe("sub_legacy");

    await handleInvoicePaymentSucceeded(legacyInvoice, log);

    expect(h.eqMock).toHaveBeenCalledWith("stripeSubscriptionId", "sub_legacy");
    expect(h.renewMembershipMock).toHaveBeenCalledOnce();
    expect(h.renewMembershipMock).toHaveBeenCalledWith(314);
  });

  it("logs and skips renewal when neither payload shape has a subscription", async () => {
    const unrelatedInvoice = invoice({ parent: null });

    await handleInvoicePaymentSucceeded(unrelatedInvoice, log);

    expect(h.selectMock).not.toHaveBeenCalled();
    expect(h.renewMembershipMock).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      { invoiceId: "in_test" },
      expect.stringContaining("missing subscription id"),
    );
  });
});