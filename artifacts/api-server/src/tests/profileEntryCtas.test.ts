import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";

const workspaceRoot = path.resolve(process.cwd(), "../..");
const webSrc = path.join(workspaceRoot, "artifacts/web/src");

function readWeb(relativePath: string) {
  return readFileSync(path.join(webSrc, relativePath), "utf8");
}

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(absolute);
    return entry.name.endsWith(".tsx") ? [absolute] : [];
  });
}

function activeOpeningTags(source: string, labelIndex: number) {
  return ["Link", "Button", "button"].flatMap((tag) => {
    const openingIndex = source.lastIndexOf(`<${tag}`, labelIndex);
    const closingIndex = source.lastIndexOf(`</${tag}>`, labelIndex);
    if (openingIndex < 0 || closingIndex > openingIndex) return [];
    let openingEnd = source.indexOf(">", openingIndex);
    while (openingEnd >= 0 && source[openingEnd - 1] === "=") {
      openingEnd = source.indexOf(">", openingEnd + 1);
    }
    if (openingEnd < 0 || openingEnd > labelIndex) return [];
    return [source.slice(openingIndex, openingEnd + 1)];
  });
}

const directSurfaces = [
  "components/Navbar.tsx",
  "components/Footer.tsx",
  "pages/Home.tsx",
  "pages/Feed.tsx",
  "pages/CommunityFeed.tsx",
  "pages/Login.tsx",
  "components/lounge/LoungeLeftSidebar.tsx",
  "pages/BusinessCreate.tsx",
];

test("the shared profile entry route is the membership chooser", () => {
  assert.match(
    readWeb("lib/routes.ts"),
    /export const PROFILE_ENTRY_PATH = "\/choose-membership" as const;/,
  );
});

test("all general profile-entry CTA variants use the shared route", () => {
  const labels = [
    "Become a Buddy",
    "Create a Free Profile",
    "Create Free Profile",
    "Join Free",
    "Start Free",
    "Create Profile",
    "Create Your Profile",
  ];

  for (const absolutePath of collectTsxFiles(webSrc)) {
    const relativePath = path.relative(webSrc, absolutePath);
    const source = readFileSync(absolutePath, "utf8");
    for (const label of labels) {
      let index = source.indexOf(label);
      while (index >= 0) {
        const tags = activeOpeningTags(source, index);
        if (tags.length > 0) {
          assert.ok(
            tags.some((tag) => tag.includes("PROFILE_ENTRY_PATH")),
            `${relativePath}: interactive "${label}" must use PROFILE_ENTRY_PATH`,
          );
        }
        index = source.indexOf(label, index + label.length);
      }
    }
  }
});

test("named visitor entry surfaces import and use PROFILE_ENTRY_PATH", () => {
  for (const relativePath of directSurfaces) {
    const source = readWeb(relativePath);
    assert.match(
      source,
      /import \{ PROFILE_ENTRY_PATH \} from "@\/lib\/routes";/,
      `${relativePath} must import the shared route`,
    );
    assert.match(source, /(?:href=\{PROFILE_ENTRY_PATH\}|setLocation\(PROFILE_ENTRY_PATH\))/);
  }

  const navbar = readWeb("components/Navbar.tsx");
  assert.equal(
    (navbar.match(/href=\{PROFILE_ENTRY_PATH\}/g) ?? []).length,
    4,
    "desktop/mobile Become a Buddy and Create Free Profile must share the entry route",
  );
  const footer = readWeb("components/Footer.tsx");
  assert.equal((footer.match(/href=\{PROFILE_ENTRY_PATH\}/g) ?? []).length, 2);

  const home = readWeb("pages/Home.tsx");
  assert.equal(
    (home.match(/href=\{PROFILE_ENTRY_PATH\}/g) ?? []).length,
    4,
    "hero, member tile, generic Buddy, and final free-profile CTAs use the chooser",
  );

  for (const relativePath of ["pages/Feed.tsx", "pages/CommunityFeed.tsx"]) {
    assert.match(
      readWeb(relativePath),
      /<Link href=\{PROFILE_ENTRY_PATH\}>[\s\S]*?Create Free Profile[\s\S]*?<\/Link>/,
    );
  }
  assert.match(
    readWeb("pages/Login.tsx"),
    /href=\{PROFILE_ENTRY_PATH\}[^>]*>Create Free Profile<\/Link>/,
  );
  const loungeSidebar = readWeb("components/lounge/LoungeLeftSidebar.tsx");
  assert.match(loungeSidebar, /: PROFILE_ENTRY_PATH;/);
  assert.match(
    loungeSidebar,
    /href=\{PROFILE_ENTRY_PATH\}[\s\S]*?Create Free Profile[\s\S]*?<\/Link>/,
  );
  assert.match(
    readWeb("pages/BusinessCreate.tsx"),
    /setLocation\(PROFILE_ENTRY_PATH\)[\s\S]*?Create Free Profile/,
  );
});

test("explicit application, plan selection, submission, and app routes remain intact", () => {
  const chooseMembership = readWeb("pages/ChooseMembership.tsx");
  assert.match(chooseMembership, /`\/signup\/bro\?plan=\$\{slug\}`/);
  assert.match(chooseMembership, /`\/checkout\?type=membership&plan=\$\{slug\}`/);
  assert.match(chooseMembership, /: "\/dashboard\/member"/);

  const pricing = readWeb("pages/Pricing.tsx");
  assert.match(pricing, /navigate\(`\/signup\/bro\?plan=\$\{plan\.slug\}`\)/);
  assert.match(pricing, /navigate\(`\/checkout\?type=membership&plan=\$\{plan\.slug\}`\)/);
  assert.match(pricing, /navigate\("\/dashboard\/member"\)/);
  assert.match(
    pricing,
    /<Link href="\/signup\/doll"[\s\S]*?Apply as a Buddy[\s\S]*?<\/Link>/,
  );

  const login = readWeb("pages/Login.tsx");
  assert.match(
    login,
    /<Link href="\/signup\/doll"[^>]*>Apply as a Buddy<\/Link>/,
  );

  const home = readWeb("pages/Home.tsx");
  assert.match(
    home,
    /<Link href="\/signup\/doll">[\s\S]*?Create my Buddy profile[\s\S]*?Free to apply · Approval after verification/,
    "the clearly separated Female Buddy application path remains direct",
  );

  const signupMember = readWeb("pages/SignupMember.tsx");
  assert.match(
    signupMember,
    /setLocation\(`\/checkout\?type=membership&plan=\$\{selectedPlan\.slug\}`\)/,
  );
  assert.match(signupMember, /setLocation\("\/dashboard\/member"\)/);
  assert.match(readWeb("pages/SignupDoll.tsx"), /setLocation\("\/verification"\)/);

  const app = readWeb("App.tsx");
  for (const route of [
    "/signup/doll",
    "/signup/member",
    "/signup/bro",
    "/checkout",
    "/verification",
    "/dashboard/member",
    "/dashboard/doll",
  ]) {
    assert.ok(app.includes(`<Route path="${route}"`), `${route} route must remain declared`);
  }
});

test("general visitor links cannot shortcut member registration or bronze signup", () => {
  for (const absolutePath of collectTsxFiles(webSrc)) {
    const relativePath = path.relative(webSrc, absolutePath);
    const source = readFileSync(absolutePath, "utf8");
    assert.doesNotMatch(
      source,
      /(?:href\s*=\s*|setLocation\(\s*|navigate\(\s*)["'`]\/signup\/(?:member|bro\?plan=bronze)/,
      `${relativePath} must route general visitors through PROFILE_ENTRY_PATH`,
    );
  }
});