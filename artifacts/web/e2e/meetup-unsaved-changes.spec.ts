import { expect, test, type Page, type Route } from "@playwright/test";

const DRAFT_ID = 84;
const WARNING_MESSAGE = "You have unsaved Meetup changes. Leave without saving them?";
const ORIGINAL_NAME = "Saturday Smoke Circle";

const draftResponse = {
  group: {
    id: DRAFT_ID,
    name: ORIGINAL_NAME,
  },
  data: {
    name: ORIGINAL_NAME,
    description: "A relaxed meetup draft for local hookah fans.",
    category: "Hookah",
    interests: ["Dark Leaf Tobacco"],
    tags: ["weekend"],
    privacy: "public",
    visibility: "visible",
    title: "Saturday Night Session",
    eventDescription: "Bring a favorite flavor to share.",
    eventFormat: "in_person",
    startsAt: "2026-09-06T01:00:00.000Z",
    endsAt: "2026-09-06T03:00:00.000Z",
    venueName: "Test Lounge",
    address: "123 Test Street",
    city: "Las Vegas",
    state: "NV",
    zip: "89101",
    hideAttendees: false,
    attendeeLimit: 12,
    waitlistEnabled: true,
    allowGuests: false,
    maxGuestsPerRsvp: 1,
    isPaid: false,
  },
};

async function mockMeetupDraftApis(page: Page) {
  await page.addInitScript(() => localStorage.setItem("ageVerified", "true"));

  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/api/auth/me") {
      await route.fulfill({
        json: {
          authenticated: true,
          user: {
            id: 84,
            email: "meetup-warning@example.com",
            name: "Meetup Warning Tester",
            role: "member",
            accountStatus: "active",
            dollId: null,
          },
        },
      });
      return;
    }

    if (url.pathname === `/api/groups/meetup-drafts/${DRAFT_ID}`) {
      await route.fulfill({ status: 200, json: draftResponse });
      return;
    }

    if (url.pathname === "/api/notifications/unread-count") {
      await route.fulfill({ json: { count: 0 } });
      return;
    }

    await route.fulfill({ json: [] });
  });
}

async function openDraft(page: Page) {
  await mockMeetupDraftApis(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/meetups/create?draftId=${DRAFT_ID}`);
  await expect(page.getByRole("heading", { name: "Start a Meetup" })).toBeVisible();
  await expect(page.getByLabel("Meetup Name *")).toHaveValue(ORIGINAL_NAME);
}

test("an untouched loaded draft can be left without a warning", async ({ page }) => {
  await openDraft(page);
  let dialogCount = 0;
  page.on("dialog", async (dialog) => {
    dialogCount += 1;
    await dialog.dismiss();
  });

  await page.locator('a[href="/meetups"]:visible').first().click();

  await expect(page).toHaveURL(/\/meetups$/);
  expect(dialogCount).toBe(0);
});

test("editing a field warns on internal navigation and reload, and cancelling preserves edits", async ({
  page,
}) => {
  await openDraft(page);
  const changedName = "Saturday Smoke Circle — edited";
  await page.getByLabel("Meetup Name *").fill(changedName);

  const navigationDialog = page.waitForEvent("dialog");
  const navigationAttempt = page.locator('a[href="/meetups"]:visible').first().click();
  const internalWarning = await navigationDialog;
  expect(internalWarning.message()).toBe(WARNING_MESSAGE);
  await internalWarning.dismiss();
  await navigationAttempt;

  await expect(page).toHaveURL(new RegExp(`/meetups/create\\?draftId=${DRAFT_ID}$`));
  await expect(page.getByLabel("Meetup Name *")).toHaveValue(changedName);

  const reloadDialog = page.waitForEvent("dialog");
  const reloadAttempt = page.reload();
  const reloadWarning = await reloadDialog;
  expect(reloadWarning.type()).toBe("beforeunload");
  await reloadWarning.accept();
  await reloadAttempt;

  await expect(page).toHaveURL(new RegExp(`/meetups/create\\?draftId=${DRAFT_ID}$`));
  await expect(page.getByLabel("Meetup Name *")).toHaveValue(ORIGINAL_NAME);
});

test("selecting an image marks the draft dirty", async ({ page }) => {
  await openDraft(page);
  await page.locator("#event-cover-upload").setInputFiles({
    name: "event-cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });

  const warning = page.waitForEvent("dialog");
  const navigationAttempt = page.locator('a[href="/meetups"]:visible').first().click();
  const dialog = await warning;
  expect(dialog.message()).toBe(WARNING_MESSAGE);
  await dialog.dismiss();
  await navigationAttempt;

  await expect(page).toHaveURL(new RegExp(`/meetups/create\\?draftId=${DRAFT_ID}$`));
  await expect(page.getByText("event-cover.png")).toHaveCount(0);
  await expect(page.locator('img[alt="Event cover preview"]')).toBeVisible();
});

test("saving a dirty draft clears the navigation warning", async ({ page }) => {
  await openDraft(page);
  const changedName = "Saved Saturday Smoke Circle";
  let savedBody: unknown;

  await page.route(`**/api/groups/meetup-drafts/${DRAFT_ID}`, async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }
    savedBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      json: {
        ...draftResponse,
        group: { ...draftResponse.group, name: changedName },
        data: { ...draftResponse.data, ...(savedBody as object) },
      },
    });
  });

  await page.getByLabel("Meetup Name *").fill(changedName);
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Meetup draft saved")).toBeVisible();
  expect(savedBody).toEqual(expect.objectContaining({ name: changedName }));

  let dialogCount = 0;
  page.on("dialog", async (dialog) => {
    dialogCount += 1;
    await dialog.dismiss();
  });
  await page.locator('a[href="/meetups"]:visible').first().click();

  await expect(page).toHaveURL(/\/meetups$/);
  expect(dialogCount).toBe(0);
});