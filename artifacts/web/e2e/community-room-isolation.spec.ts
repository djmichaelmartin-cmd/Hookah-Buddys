import { expect, test, type Page } from "@playwright/test";

const TEST_HASHTAG = {
  tag: "testsmoke",
  displayTag: "TestSmoke",
  postCount: 3,
  score: 12,
};

async function mockCommunityApis(page: Page, feedRequests: URL[]) {
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
            id: 101,
            role: "member",
            email: "community-test@example.com",
            name: "Community Test Member",
            accountStatus: "active",
            dollId: null,
          },
        },
      });
      return;
    }

    if (url.pathname === "/api/feed/posts") {
      feedRequests.push(url);
      await route.fulfill({ json: [] });
      return;
    }

    if (url.pathname === "/api/feed/hashtags/trending") {
      await route.fulfill({ json: [TEST_HASHTAG] });
      return;
    }

    await route.fulfill({ json: [] });
  });
}

async function selectTrendingHashtag(page: Page, feedRequests: URL[], category: string) {
  await page.getByRole("button", { name: `#${TEST_HASHTAG.displayTag}` }).click();
  await page.getByRole("button", { name: "Trending", exact: true }).click();

  await expect(page.getByRole("button", { name: "Trending", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: `#${TEST_HASHTAG.tag}`, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      feedRequests.some(
        (url) =>
          url.searchParams.get("category") === category &&
          url.searchParams.get("filter") === "trending" &&
          url.searchParams.get("hashtag") === TEST_HASHTAG.tag,
      ),
    )
    .toBe(true);
}

async function expectIsolatedRoom(
  page: Page,
  feedRequests: URL[],
  expected: { heading: string; category: string; categoryLabel: string },
) {
  await expect(page.getByRole("heading", { name: expected.heading, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: `#${TEST_HASHTAG.tag}`, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox")).toContainText(expected.categoryLabel);

  await expect
    .poll(() =>
      feedRequests.some(
        (url) =>
          url.searchParams.get("category") === expected.category &&
          url.searchParams.get("filter") === "new" &&
          !url.searchParams.has("hashtag"),
      ),
    )
    .toBe(true);

  expect(feedRequests.length).toBeGreaterThan(0);
  expect(
    feedRequests.map((url) => ({
      category: url.searchParams.get("category"),
      filter: url.searchParams.get("filter"),
      hashtag: url.searchParams.get("hashtag"),
    })),
  ).toEqual(
    feedRequests.map(() => ({
      category: expected.category,
      filter: "new",
      hashtag: null,
    })),
  );
}

test("desktop community sidebar clears room-specific feed state", async ({ page }) => {
  const feedRequests: URL[] = [];
  await mockCommunityApis(page, feedRequests);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/community/hookah-memes");
  await selectTrendingHashtag(page, feedRequests, "meme");
  feedRequests.length = 0;

  await page.locator('a[href="/community/questions"]:visible').click();

  await expectIsolatedRoom(page, feedRequests, {
    heading: "Questions",
    category: "question",
    categoryLabel: "Question",
  });
});

test("mobile topic navigator clears room-specific feed state", async ({ page }) => {
  const feedRequests: URL[] = [];
  await mockCommunityApis(page, feedRequests);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/community/questions");
  await selectTrendingHashtag(page, feedRequests, "question");
  feedRequests.length = 0;

  await page
    .getByRole("navigation", { name: "Hookah Community" })
    .getByRole("link", { name: "Hookah Memes", exact: true })
    .click();

  await expectIsolatedRoom(page, feedRequests, {
    heading: "Hookah Memes",
    category: "meme",
    categoryLabel: "Meme",
  });
});