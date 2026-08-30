import { expect, test, type Page } from "@playwright/test";

const ADMIN_SECTIONS = [
  { label: "Applications", path: "/admin/applications" },
  { label: "Media Moderation", path: "/admin/media-moderation" },
  { label: "Verifications", path: "/admin/verifications" },
  { label: "Lounge", path: "/admin/lounge" },
  { label: "Shares", path: "/admin/shares" },
  { label: "Photos", path: "/admin/photos" },
  { label: "Sparks", path: "/admin/sparks" },
  { label: "Blocks", path: "/admin/blocks" },
  { label: "Users", path: "/admin/users" },
  { label: "Profiles", path: "/admin/profiles" },
  { label: "Credits", path: "/admin/credits" },
  { label: "Plans", path: "/admin/plans" },
  { label: "Events", path: "/admin/events" },
  { label: "Leads", path: "/admin/leads" },
  { label: "Businesses", path: "/admin/businesses" },
  { label: "Groups", path: "/admin/groups" },
  { label: "Custom Requests", path: "/admin/custom-requests" },
] as const;

async function mockAdminApis(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("ageVerified", "true");
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/api/auth/me") {
      await route.fulfill({
        json: {
          authenticated: true,
          user: {
            id: 1,
            role: "admin",
            email: "admin-navigation@example.com",
            name: "Admin Navigation",
            accountStatus: "active",
            dollId: null,
          },
        },
      });
      return;
    }

    if (url.pathname === "/api/admin/stats") {
      await route.fulfill({
        json: {
          totalRevenue: 0,
          monthlyRevenue: 0,
          totalDolls: 0,
          pendingApplications: 0,
          pendingMedia: 0,
          revenueBreakdown: [],
        },
      });
      return;
    }

    if (url.pathname === "/api/admin/credit-transactions") {
      await route.fulfill({ json: { items: [], total: 0 } });
      return;
    }

    if (url.pathname === "/api/admin/groups") {
      await route.fulfill({ json: { groups: [], total: 0 } });
      return;
    }

    if (url.pathname === "/api/admin/businesses") {
      await route.fulfill({ json: [] });
      return;
    }

    if (url.pathname === "/api/admin/leads") {
      await route.fulfill({ json: { leads: [], total: 0 } });
      return;
    }

    if (url.pathname === "/api/admin/leads/rejected") {
      await route.fulfill({ json: { rejected: [], total: 0 } });
      return;
    }

    if (url.pathname === "/api/admin/leads/summary") {
      await route.fulfill({
        json: {
          total: 0,
          rejectedTotal: 0,
          byState: [],
          byCity: [],
          byCategory: [],
          byStatus: [],
        },
      });
      return;
    }

    await route.fulfill({ json: [] });
  });
}

test.beforeEach(async ({ page }) => {
  await mockAdminApis(page);
});

test("every canonical admin URL renders and highlights its desktop section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const section of ADMIN_SECTIONS) {
    await page.goto(section.path);

    await expect(page).toHaveURL(new RegExp(`${section.path}$`));
    await expect(page.getByRole("heading", { name: section.label, exact: true }).first()).toBeVisible();

    const desktopNavigation = page.getByRole("navigation", { name: "Admin sections" });
    await expect(
      desktopNavigation.getByRole("button", { name: section.label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(desktopNavigation.locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test("legacy admin URLs keep their documented section behavior", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/admin/groups");
  await expect(page.getByRole("heading", { name: "Groups", exact: true }).first()).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Admin sections" })
      .getByRole("button", { name: "Groups", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.goto("/admin/meetups");
  await expect(page).toHaveURL(/\/admin\/meetups$/);
  await expect(page.getByRole("heading", { name: "Events", exact: true }).first()).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Admin sections" })
      .getByRole("button", { name: "Events", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("an invalid admin section falls back to Applications without rewriting the URL", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/admin/not-a-section");

  await expect(page).toHaveURL(/\/admin\/not-a-section$/);
  await expect(page.getByRole("heading", { name: "Applications", exact: true }).first()).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Admin sections" })
      .getByRole("button", { name: "Applications", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("mobile drawer navigation closes the drawer and opens the selected section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/applications");

  await page.getByRole("button", { name: "Open admin navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Admin navigation" });
  await expect(drawer).toBeVisible();

  await drawer.getByRole("button", { name: "Businesses", exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/businesses$/);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { name: "Businesses", exact: true }).first()).toBeVisible();
});