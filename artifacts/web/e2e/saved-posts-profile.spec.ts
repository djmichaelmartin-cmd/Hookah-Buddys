import { expect, test, type Page, type Route } from "@playwright/test";

async function mockMemberApi(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/api/auth/me") {
      await route.fulfill({
        json: {
          authenticated: true,
          user: {
            id: 42,
            email: "saved-posts@example.com",
            name: "Saved Posts Tester",
            role: "member",
            username: "saved-posts-tester",
            profilePhotoUrl: null,
          },
        },
      });
      return;
    }

    if (path === "/api/notifications/unread-count") {
      await route.fulfill({ json: { count: 0 } });
      return;
    }

    if (path === "/api/credits") {
      await route.fulfill({
        json: {
          balance: 0,
          membershipBalance: 0,
          purchasedBalance: 0,
          monthlyMembershipCredits: 0,
          membershipPlanName: null,
          nextRefreshAt: null,
          transactions: [],
        },
      });
      return;
    }

    await route.fulfill({ json: [] });
  });
}

test("member profile menu opens the private Saved Posts tab", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ageVerified", "true"));
  await mockMemberApi(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Saved Posts Tester account menu" }).click();
  await page.getByRole("menuitem", { name: "Saved Posts" }).click();

  await expect(page).toHaveURL(/\/dashboard\/member\?tab=saved$/);
  await expect(page.getByRole("tab", { name: "My Posts & Activity" })).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.getByRole("tab", { name: "Saved", exact: true })).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.getByText("No saved posts.")).toBeVisible();
});