import { expect, test, type Page, type Route } from "@playwright/test";

type SpotlightState =
  | "login_required"
  | "location_required"
  | "ready"
  | "partial"
  | "empty";

type SpotlightCard = {
  id: number;
  handle: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  businessType: string;
  category: string | null;
  city: string;
  state: string;
  tagline: string | null;
  distanceMiles: number;
  averageRating: number;
  reviewCount: number;
  weightedRating: number;
  verified: boolean;
  featured: boolean;
  openNow: boolean | null;
  followed: boolean;
  legacyLoungeId: number | null;
};

type SpotlightResponse = {
  date: string;
  radiusMiles: number;
  locationLabel: string | null;
  state: SpotlightState;
  message: string;
  businesses: SpotlightCard[];
};

type MockApiOptions = {
  spotlight: SpotlightResponse;
  authenticated?: boolean;
  role?: "member" | "admin";
  lounges?: Record<string, unknown>[];
  adminBusinesses?: Record<string, unknown>[];
  spotlightAfterLocationSave?: SpotlightResponse;
};

const SPOTLIGHT_DATE = "2026-08-20";

const SPOTLIGHT_CARDS: SpotlightCard[] = [
  {
    id: 301,
    handle: "ember-room",
    name: "Ember Room",
    logoUrl: null,
    coverUrl: null,
    businessType: "lounge",
    category: "Hookah Lounge",
    city: "Austin",
    state: "TX",
    tagline: "Late-night tea and premium bowls.",
    distanceMiles: 2.4,
    averageRating: 4.9,
    reviewCount: 84,
    weightedRating: 4.72,
    verified: true,
    featured: true,
    openNow: true,
    followed: false,
    legacyLoungeId: 701,
  },
  {
    id: 302,
    handle: "cedar-social",
    name: "Cedar Social",
    logoUrl: null,
    coverUrl: null,
    businessType: "lounge",
    category: "Hookah Bar",
    city: "Austin",
    state: "TX",
    tagline: "A relaxed neighborhood lounge.",
    distanceMiles: 4.1,
    averageRating: 4.8,
    reviewCount: 61,
    weightedRating: 4.61,
    verified: true,
    featured: false,
    openNow: false,
    followed: false,
    legacyLoungeId: null,
  },
  {
    id: 303,
    handle: "blue-hour",
    name: "Blue Hour",
    logoUrl: null,
    coverUrl: null,
    businessType: "lounge",
    category: "Hookah Lounge",
    city: "Austin",
    state: "TX",
    tagline: "Modern lounge with a quiet patio.",
    distanceMiles: 6.8,
    averageRating: 4.7,
    reviewCount: 43,
    weightedRating: 4.48,
    verified: false,
    featured: false,
    openNow: null,
    followed: true,
    legacyLoungeId: null,
  },
];

const LEGACY_LOUNGES = [
  {
    id: 701,
    name: "Ember Room",
    address: "1 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    lat: 30.2672,
    lng: -97.7431,
    rating: 4.9,
    priceLevel: 2,
    hours: "Open late",
    description: "The legacy entry matched to the Spotlight business.",
    imageUrl: null,
    phone: null,
    website: null,
  },
  {
    id: 702,
    name: "Ember Room",
    address: "99 Different Ave",
    city: "Austin",
    state: "TX",
    zip: "78702",
    lat: 30.29,
    lng: -97.7,
    rating: 4.2,
    priceLevel: 2,
    hours: "Open daily",
    description: "A same-name venue that must not be hidden.",
    imageUrl: null,
    phone: null,
    website: null,
  },
  {
    id: 703,
    name: "Unrelated Directory Lounge",
    address: "5 Congress Ave",
    city: "Austin",
    state: "TX",
    zip: "78701",
    lat: 30.26,
    lng: -97.74,
    rating: 4.5,
    priceLevel: 2,
    hours: "Open daily",
    description: "A directory-only venue.",
    imageUrl: null,
    phone: null,
    website: null,
  },
];

function spotlightResponse(
  state: SpotlightState,
  businesses: SpotlightCard[] = [],
  message?: string,
): SpotlightResponse {
  const defaultMessages: Record<SpotlightState, string> = {
    login_required: "Log in or add your city to see Lounge Spotlights near you.",
    location_required: "Add your city to see local Lounge Spotlights near you.",
    ready: "Today's top-rated Lounge Spotlights near Austin, TX.",
    partial: "Showing the best available Lounge Spotlights near Austin, TX.",
    empty: "No local Lounge Spotlights found within 25 miles.",
  };

  return {
    date: SPOTLIGHT_DATE,
    radiusMiles: 25,
    locationLabel: state === "login_required" ? null : "Austin, TX",
    state,
    message: message ?? defaultMessages[state],
    businesses,
  };
}

function adminBusiness(eligibleForLoungeSpotlight: boolean) {
  return {
    id: 901,
    handle: "admin-smoke-lounge",
    name: "Admin Smoke Lounge",
    businessType: "lounge",
    category: "Hookah Lounge",
    tagline: null,
    logoUrl: null,
    coverUrl: null,
    city: "Austin",
    state: "TX",
    averageRating: 4.8,
    reviewCount: 20,
    followerCount: 10,
    checkInCount: 4,
    badges: [],
    status: "active",
    isPublished: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    eligibleForLoungeSpotlight,
    hasUsableSpotlightLocation: true,
    hasUsableSpotlightRating: true,
    spotlightWeightedRating: 4.5,
  };
}

function sensitiveResponseKeys(value: unknown, prefix = ""): string[] {
  const forbidden = new Set([
    "lat",
    "lng",
    "latitude",
    "longitude",
    "userId",
    "memberUserId",
    "ownerUserId",
    "coarseLocationKey",
    "locationKey",
  ]);
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => sensitiveResponseKeys(item, `${prefix}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [
      ...(forbidden.has(key) ? [path] : []),
      ...sensitiveResponseKeys(child, path),
    ];
  });
}

async function installApiMocks(page: Page, options: MockApiOptions) {
  const state = {
    spotlight: structuredClone(options.spotlight),
    adminBusinesses: structuredClone(options.adminBusinesses ?? []),
  };
  const captured = {
    spotlightRequests: [] as URL[],
    locationSaves: [] as { url: URL; body: Record<string, unknown> }[],
    followedHandles: [] as string[],
    moderationActions: [] as { handle: string; body: Record<string, unknown> }[],
  };

  await page.addInitScript(() => {
    window.localStorage.setItem("ageVerified", "true");
  });

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === "/api/auth/me") {
      const authenticated = options.authenticated ?? true;
      await route.fulfill({
        json: authenticated
          ? {
              authenticated: true,
              user: {
                id: options.role === "admin" ? 1 : 101,
                role: options.role ?? "member",
                email: "spotlight-browser-test@example.com",
                name: "Spotlight Browser Test",
                accountStatus: "active",
                dollId: null,
              },
            }
          : { authenticated: false, user: null },
      });
      return;
    }

    if (url.pathname === "/api/lounge-spotlight/local" && method === "GET") {
      captured.spotlightRequests.push(url);
      await route.fulfill({ json: state.spotlight });
      return;
    }

    if (url.pathname === "/api/lounge-spotlight/location" && method === "PUT") {
      const body = request.postDataJSON() as Record<string, unknown>;
      captured.locationSaves.push({ url, body });
      if (options.spotlightAfterLocationSave) {
        state.spotlight = structuredClone(options.spotlightAfterLocationSave);
      }
      await route.fulfill({ json: { saved: true } });
      return;
    }

    if (url.pathname === "/api/lounges" && method === "GET") {
      await route.fulfill({ json: options.lounges ?? [] });
      return;
    }

    const followMatch = url.pathname.match(/^\/api\/businesses\/([^/]+)\/follow$/);
    if (followMatch && method === "POST") {
      const handle = decodeURIComponent(followMatch[1]);
      captured.followedHandles.push(handle);
      const business = state.spotlight.businesses.find((candidate) => candidate.handle === handle);
      if (business) business.followed = !business.followed;
      await route.fulfill({
        json: {
          followed: business?.followed ?? true,
          followerCount: 11,
        },
      });
      return;
    }

    if (url.pathname === "/api/admin/businesses" && method === "GET") {
      await route.fulfill({ json: state.adminBusinesses });
      return;
    }

    const moderationMatch = url.pathname.match(
      /^\/api\/admin\/businesses\/([^/]+)\/moderate$/,
    );
    if (moderationMatch && method === "POST") {
      const handle = decodeURIComponent(moderationMatch[1]);
      const body = request.postDataJSON() as Record<string, unknown>;
      captured.moderationActions.push({ handle, body });
      state.adminBusinesses = state.adminBusinesses.map((business) =>
        business.handle === handle
          ? {
              ...business,
              eligibleForLoungeSpotlight: body.action === "spotlight_enable",
            }
          : business,
      );
      await route.fulfill({
        json: state.adminBusinesses.find((business) => business.handle === handle) ?? {},
      });
      return;
    }

    await route.fulfill({ json: [] });
  });

  return { state, captured };
}

for (const scenario of [
  {
    name: "signed-out",
    state: "login_required" as const,
    authenticated: false,
    testId: "page-spotlight-login_required",
    heading: "Log in or add your city to see Lounge Spotlights near you.",
    action: "Log in",
  },
  {
    name: "missing-location",
    state: "location_required" as const,
    authenticated: true,
    testId: "page-spotlight-location_required",
    heading: "Add your city to see local Lounge Spotlights near you.",
    action: "Update Profile City",
  },
  {
    name: "empty",
    state: "empty" as const,
    authenticated: true,
    testId: "page-spotlight-empty",
    heading: "No local Lounge Spotlights found within 25 miles.",
    action: "Browse All Lounges",
  },
]) {
  test(`${scenario.name} Spotlight state shows a useful fallback`, async ({ page }) => {
    await installApiMocks(page, {
      authenticated: scenario.authenticated,
      spotlight: spotlightResponse(scenario.state),
    });

    await page.goto("/lounges");

    const state = page.getByTestId(scenario.testId);
    await expect(state).toBeVisible();
    await expect(state.getByRole("heading", { name: scenario.heading })).toBeVisible();
    await expect(state.getByRole("link", { name: scenario.action })).toBeVisible();
  });
}

test("sidebar and Lounge page keep the same daily order without leaking private location data", async ({
  page,
}) => {
  const ready = spotlightResponse("ready", SPOTLIGHT_CARDS);
  const { captured } = await installApiMocks(page, {
    spotlight: ready,
    lounges: LEGACY_LOUNGES,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/lounge-spotlight/local",
  );
  await page.goto("/feed");
  const response = await responsePromise;

  expect(response.request().method()).toBe("GET");
  expect(new URL(response.url()).search).toBe("");
  expect(sensitiveResponseKeys(await response.json())).toEqual([]);
  expect(captured.spotlightRequests.every((url) => url.search === "")).toBe(true);

  const sidebarRows = page
    .locator('[data-testid="sidebar-spotlight-cards"]:visible')
    .locator(":scope > div");
  await expect(sidebarRows).toHaveCount(3);
  const sidebarNames = await sidebarRows.evaluateAll((rows) =>
    rows.map((row) => row.querySelector("p span")?.textContent?.trim()),
  );
  expect(sidebarNames).toEqual(SPOTLIGHT_CARDS.map((business) => business.name));

  await page.locator('[data-testid="link-lounge-spotlight"]:visible').click();
  await expect(page).toHaveURL(/\/lounges\?spotlight=local$/);

  const pageHandles = await page
    .getByTestId("section-lounge-spotlight")
    .locator('[data-testid^="card-spotlight-"]')
    .evaluateAll((cards) =>
      cards.map((card) =>
        card.getAttribute("data-testid")?.replace("card-spotlight-", ""),
      ),
    );
  expect(pageHandles).toEqual(SPOTLIGHT_CARDS.map((business) => business.handle));

  const directory = page.getByTestId("legacy-lounge-directory");
  await expect(directory.getByText("Ember Room", { exact: true })).toHaveCount(1);
  await expect(
    directory.getByText("A same-name venue that must not be hidden.", { exact: true }),
  ).toBeVisible();
  await expect(
    directory.getByText("The legacy entry matched to the Spotlight business.", {
      exact: true,
    }),
  ).toHaveCount(0);

  const mapMarkers = page.locator(".leaflet-marker-icon");
  await expect(mapMarkers).toHaveCount(3);
  await mapMarkers.first().click({ force: true });
  await expect(directory.getByText("Ember Room", { exact: true })).toHaveCount(1);
  await expect(
    directory.getByText("The legacy entry matched to the Spotlight business.", {
      exact: true,
    }),
  ).toHaveCount(0);
});

test("location save keeps coordinates in the request body and refreshes Spotlight safely", async ({
  page,
  context,
}) => {
  const readyAfterSave = spotlightResponse("ready", SPOTLIGHT_CARDS);
  const { captured } = await installApiMocks(page, {
    spotlight: spotlightResponse("location_required"),
    spotlightAfterLocationSave: readyAfterSave,
  });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });

  await page.goto("/lounges");
  await expect(page.getByTestId("page-spotlight-location_required")).toBeVisible();

  const saveResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/lounge-spotlight/location",
  );
  const refreshedSpotlightPromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/lounge-spotlight/local" &&
      captured.spotlightRequests.length >= 2,
  );
  await page.getByRole("button", { name: "Use my location" }).click();

  const saveResponse = await saveResponsePromise;
  expect(new URL(saveResponse.url()).search).toBe("");
  expect(await saveResponse.json()).toEqual({ saved: true });
  expect(sensitiveResponseKeys(await saveResponse.body().then((body) => JSON.parse(body.toString()))))
    .toEqual([]);
  expect(captured.locationSaves).toHaveLength(1);
  expect(captured.locationSaves[0].url.search).toBe("");
  expect(captured.locationSaves[0].body).toMatchObject({
    latitude: 30.2672,
    longitude: -97.7431,
  });

  const spotlightResponseAfterSave = await refreshedSpotlightPromise;
  expect(sensitiveResponseKeys(await spotlightResponseAfterSave.json())).toEqual([]);
  await expect(page.getByTestId("card-spotlight-ember-room")).toBeVisible();
});

test("follow and full-card navigation remain independent", async ({ page }) => {
  const { captured } = await installApiMocks(page, {
    spotlight: spotlightResponse("ready", SPOTLIGHT_CARDS),
  });

  await page.goto("/lounges");
  const followButton = page.getByTestId("button-follow-ember-room");
  await expect(followButton).toHaveText(/^\s*Follow\s*$/);
  await followButton.click();

  await expect.poll(() => captured.followedHandles).toEqual(["ember-room"]);
  await expect(followButton).toHaveText(/Following/);
  await expect(page).toHaveURL(/\/lounges$/);

  await page.getByTestId("card-spotlight-cedar-social").click();
  await expect(page).toHaveURL(/\/business\/cedar-social$/);
});

test("partial Spotlight stays usable without horizontal overflow at 390px", async ({ page }) => {
  await installApiMocks(page, {
    spotlight: spotlightResponse("partial", SPOTLIGHT_CARDS.slice(0, 1)),
  });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/lounges");
  await expect(page.getByTestId("page-spotlight-partial")).toContainText(
    "More local Lounge Spotlights coming soon.",
  );

  for (const testId of [
    "button-follow-ember-room",
    "button-message-ember-room",
    "link-business-ember-room",
  ]) {
    const action = page.getByTestId(testId);
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }

  const horizontalMetrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(horizontalMetrics.documentWidth).toBeLessThanOrEqual(
    horizontalMetrics.viewportWidth,
  );
});

test("admins can enable and disable Spotlight eligibility", async ({ page }) => {
  const { captured } = await installApiMocks(page, {
    role: "admin",
    spotlight: spotlightResponse("empty"),
    adminBusinesses: [adminBusiness(false)],
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/admin");
  await page.getByRole("tab", { name: "Businesses", exact: true }).click();

  const row = page.getByRole("row").filter({ hasText: "Admin Smoke Lounge" });
  await expect(row.getByText("Ineligible", { exact: true })).toBeVisible();
  await row.getByRole("button").click();
  await page.getByTestId("menu-spotlight-enable-admin-smoke-lounge").click();
  await expect(
    page.getByRole("heading", {
      name: "spotlight enable — Admin Smoke Lounge",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm Action" }).click();
  await expect(row.getByText("Eligible", { exact: true })).toBeVisible();

  await row.getByRole("button").click();
  await page.getByTestId("menu-spotlight-disable-admin-smoke-lounge").click();
  await expect(
    page.getByRole("heading", {
      name: "spotlight disable — Admin Smoke Lounge",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm Action" }).click();
  await expect(row.getByText("Ineligible", { exact: true })).toBeVisible();

  expect(captured.moderationActions).toEqual([
    {
      handle: "admin-smoke-lounge",
      body: { action: "spotlight_enable" },
    },
    {
      handle: "admin-smoke-lounge",
      body: { action: "spotlight_disable" },
    },
  ]);
});