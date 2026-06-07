import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { CREDIT_PACKAGE_SEEDS, membershipMonthlyCredits, nextBillingDate } from "@workspace/pricing";
import {
  db,
  pool,
  usersTable,
  dollsTable,
  mediaTable,
  verificationsTable,
  plansTable,
  creditBalancesTable,
  creditPackagesTable,
  subscriptionsTable,
  creditTransactionsTable,
  favoritesTable,
  messagesTable,
  messageThreadsTable,
  contentUnlocksTable,
  videoChatsTable,
  boostsTable,
  reportsTable,
  contactMessagesTable,
  loungesTable,
} from "@workspace/db";

async function hash(plain: string) {
  return bcrypt.hash(plain, 10);
}

const PHOTO = (n: number) => `/dolls/doll${n}.png`;

type DollSeed = {
  email: string;
  name: string;
  stageName: string;
  city: string;
  state: string;
  age: number;
  bio: string;
  favoriteFlavor: string;
  experienceLevel: string;
  photo: number;
  verified: boolean;
  featured: boolean;
  elite: boolean;
  online: boolean;
  videoChat: boolean;
  tier: string;
  subscriptionPrice: number;
  messagePrice: number;
  videoChatRate: number;
  profileViews: number;
};

const DOLLS: DollSeed[] = [
  {
    email: "scarlett@hookahdolls.com",
    name: "Scarlett Vance",
    stageName: "Scarlett",
    city: "Miami",
    state: "FL",
    age: 26,
    bio: "Lounge queen with a love for thick clouds and slow nights. Double-apple devotee. Pull up a seat, the coals are hot.",
    favoriteFlavor: "Double Apple",
    experienceLevel: "Expert",
    photo: 1,
    verified: true,
    featured: true,
    elite: true,
    online: true,
    videoChat: true,
    tier: "elite",
    subscriptionPrice: 24.99,
    messagePrice: 2,
    videoChatRate: 6,
    profileViews: 4820,
  },
  {
    email: "luna@hookahdolls.com",
    name: "Luna Reyes",
    stageName: "Luna",
    city: "Las Vegas",
    state: "NV",
    age: 24,
    bio: "Vegas nights, mint smoke, and good vibes only. I host the smoothest sessions in the desert.",
    favoriteFlavor: "Blue Mist",
    experienceLevel: "Advanced",
    photo: 2,
    verified: true,
    featured: true,
    elite: false,
    online: true,
    videoChat: true,
    tier: "featured",
    subscriptionPrice: 19.99,
    messagePrice: 2,
    videoChatRate: 5,
    profileViews: 3110,
  },
  {
    email: "aria@hookahdolls.com",
    name: "Aria Knox",
    stageName: "Aria",
    city: "Los Angeles",
    state: "CA",
    age: 27,
    bio: "Rose-gold everything. Sunset sessions on the rooftop with a perfectly packed bowl.",
    favoriteFlavor: "Watermelon Mint",
    experienceLevel: "Expert",
    photo: 3,
    verified: true,
    featured: true,
    elite: false,
    online: false,
    videoChat: true,
    tier: "featured",
    subscriptionPrice: 21.99,
    messagePrice: 2,
    videoChatRate: 5,
    profileViews: 2740,
  },
  {
    email: "noir@hookahdolls.com",
    name: "Noir Sinclair",
    stageName: "Noir",
    city: "New York",
    state: "NY",
    age: 25,
    bio: "Midnight in Manhattan. Sleek, mysterious, and always wrapped in smoke.",
    favoriteFlavor: "Grape Mint",
    experienceLevel: "Advanced",
    photo: 4,
    verified: true,
    featured: false,
    elite: true,
    online: true,
    videoChat: false,
    tier: "elite",
    subscriptionPrice: 22.99,
    messagePrice: 3,
    videoChatRate: 0,
    profileViews: 1980,
  },
  {
    email: "jade@hookahdolls.com",
    name: "Jade Monroe",
    stageName: "Jade",
    city: "Houston",
    state: "TX",
    age: 23,
    bio: "Southern charm and champagne clouds. Let's make some memories in the lounge.",
    favoriteFlavor: "Peach",
    experienceLevel: "Intermediate",
    photo: 5,
    verified: true,
    featured: false,
    elite: false,
    online: true,
    videoChat: true,
    tier: "premium",
    subscriptionPrice: 16.99,
    messagePrice: 1,
    videoChatRate: 4,
    profileViews: 1450,
  },
  {
    email: "ivy@hookahdolls.com",
    name: "Ivy Laurent",
    stageName: "Ivy",
    city: "Chicago",
    state: "IL",
    age: 28,
    bio: "Velvet, burgundy, and slow exhales. The windy city's coziest session host.",
    favoriteFlavor: "Cherry",
    experienceLevel: "Advanced",
    photo: 6,
    verified: true,
    featured: false,
    elite: false,
    online: false,
    videoChat: false,
    tier: "premium",
    subscriptionPrice: 15.99,
    messagePrice: 1,
    videoChatRate: 0,
    profileViews: 1120,
  },
  {
    email: "zara@hookahdolls.com",
    name: "Zara Bello",
    stageName: "Zara",
    city: "Atlanta",
    state: "GA",
    age: 25,
    bio: "Gold accents and good energy. ATL's brightest doll, always down for a smooth session.",
    favoriteFlavor: "Mango Tango",
    experienceLevel: "Expert",
    photo: 7,
    verified: true,
    featured: true,
    elite: false,
    online: true,
    videoChat: true,
    tier: "featured",
    subscriptionPrice: 18.99,
    messagePrice: 2,
    videoChatRate: 5,
    profileViews: 2360,
  },
  {
    email: "mila@hookahdolls.com",
    name: "Mila Sokolova",
    stageName: "Mila",
    city: "Scottsdale",
    state: "AZ",
    age: 24,
    bio: "Satin and smoke. Desert sunsets pair best with a tall glass and a fresh bowl.",
    favoriteFlavor: "Lemon Mint",
    experienceLevel: "Intermediate",
    photo: 8,
    verified: true,
    featured: false,
    elite: false,
    online: false,
    videoChat: true,
    tier: "premium",
    subscriptionPrice: 14.99,
    messagePrice: 1,
    videoChatRate: 4,
    profileViews: 870,
  },
];

async function clear() {
  // Only remove editorial/placeholder lounges (placeId IS NULL). The real
  // directory listings (placeId IS NOT NULL) are published from collected leads
  // via `sync-lounges` and must survive a reseed.
  await db.delete(loungesTable).where(isNull(loungesTable.placeId));
  await db.delete(contactMessagesTable);
  await db.delete(reportsTable);
  await db.delete(boostsTable);
  await db.delete(videoChatsTable);
  await db.delete(contentUnlocksTable);
  await db.delete(messagesTable);
  await db.delete(messageThreadsTable);
  await db.delete(favoritesTable);
  await db.delete(creditTransactionsTable);
  await db.delete(creditBalancesTable);
  await db.delete(creditPackagesTable);
  await db.delete(subscriptionsTable);
  await db.delete(verificationsTable);
  await db.delete(mediaTable);
  await db.delete(dollsTable);
  await db.delete(plansTable);
  await db.delete(usersTable);
}

async function seedPlans() {
  await db.insert(plansTable).values([
    {
      name: "Free Membership",
      audience: "member",
      price: 0,
      interval: "month",
      tier: "free",
      monthlyCredits: membershipMonthlyCredits("free"),
      description: "Browse verified Dolls and save your favorites.",
      features: [
        "Browse profiles",
        "Save favorites",
        "No interaction without purchasing credits or upgrading",
      ],
      highlighted: false,
    },
    {
      name: "Basic Membership",
      audience: "member",
      price: 19.99,
      interval: "month",
      tier: "basic",
      monthlyCredits: membershipMonthlyCredits("basic"),
      description: "Everything in Free, plus 100 included credits every month.",
      features: [
        "Browse profiles",
        "Save favorites",
        "100 monthly credits included",
        "Limited messaging & content access",
      ],
      highlighted: false,
    },
    {
      name: "Premium Membership",
      audience: "member",
      price: 39.99,
      interval: "month",
      tier: "premium",
      monthlyCredits: membershipMonthlyCredits("premium"),
      description: "Enhanced browsing and access, plus 300 included credits every month.",
      features: [
        "300 monthly credits included",
        "Enhanced browsing",
        "Additional profile access",
        "Premium content & video chat access",
      ],
      highlighted: true,
    },
    {
      name: "Doll — Free",
      audience: "doll",
      price: 0,
      interval: "month",
      tier: "free",
      description: "Get verified and start building your audience.",
      features: ["Verified profile", "Upload free content", "Receive messages"],
      highlighted: false,
    },
    {
      name: "Doll — Premium",
      audience: "doll",
      price: 9.99,
      interval: "month",
      tier: "premium",
      description: "Sell premium content and set your own prices.",
      features: ["Everything in Free", "Premium content sales", "Custom pricing", "Basic analytics"],
      highlighted: false,
    },
    {
      name: "Doll — Featured",
      audience: "doll",
      price: 24.99,
      interval: "month",
      tier: "featured",
      description: "Get top placement in browse and search.",
      features: ["Everything in Premium", "Featured placement", "Boosted in search", "Advanced analytics"],
      highlighted: true,
    },
    {
      name: "Doll — Elite",
      audience: "doll",
      price: 49.99,
      interval: "month",
      tier: "elite",
      description: "Maximum visibility and the Elite badge.",
      features: [
        "Everything in Featured",
        "Elite badge",
        "Highest ranking priority",
        "Video chat tools",
        "Dedicated support",
      ],
      highlighted: false,
    },
  ]);
}

async function seedCreditPackages() {
  await db.insert(creditPackagesTable).values(
    CREDIT_PACKAGE_SEEDS.map((p) => ({
      slug: p.slug,
      name: p.name,
      priceCents: p.priceCents,
      credits: p.credits,
      label: p.label,
      stripePriceId: p.stripePriceId,
      sortOrder: p.sortOrder,
      active: true,
    })),
  );
}

async function seedDolls() {
  for (const d of DOLLS) {
    const [user] = await db
      .insert(usersTable)
      .values({
        role: "doll",
        name: d.name,
        email: d.email,
        passwordHash: await hash("password123"),
        city: d.city,
        state: d.state,
        username: d.stageName.toLowerCase(),
        accountStatus: "active",
        ageConfirmed: true,
        rulesAccepted: true,
        profilePhotoUrl: PHOTO(d.photo),
      })
      .returning();

    const [doll] = await db
      .insert(dollsTable)
      .values({
        userId: user.id,
        legalName: d.name,
        stageName: d.stageName,
        city: d.city,
        state: d.state,
        age: d.age,
        bio: d.bio,
        favoriteFlavor: d.favoriteFlavor,
        experienceLevel: d.experienceLevel,
        profilePhotoUrl: PHOTO(d.photo),
        verificationPhotoUrl: PHOTO(d.photo),
        verified: d.verified,
        featured: d.featured,
        elite: d.elite,
        online: d.online,
        availableForVideoChat: d.videoChat,
        tier: d.tier,
        applicationStatus: "approved",
        subscriptionPrice: d.subscriptionPrice,
        messagePrice: d.messagePrice,
        videoChatRate: d.videoChatRate,
        profileViews: d.profileViews,
      })
      .returning();

    await db.update(usersTable).set({ dollId: doll.id }).where(eqUser(user.id));

    await db.insert(verificationsTable).values({
      dollId: doll.id,
      governmentIdUrl: "https://placeholder.hookahdolls.com/id.jpg",
      selfieUrl: PHOTO(d.photo),
      hookahPhotoUrl: PHOTO(d.photo),
      status: "approved",
      notes: "Verified — visible hookah confirmed.",
    });

    await db.insert(mediaTable).values([
      {
        dollId: doll.id,
        type: "free_photo",
        url: PHOTO(d.photo),
        thumbnailUrl: PHOTO(d.photo),
        caption: `${d.stageName} in the lounge with her ${d.favoriteFlavor} bowl.`,
        status: "approved",
        containsHookah: true,
        premium: false,
        price: 0,
      },
      {
        dollId: doll.id,
        type: "premium_photo",
        url: PHOTO(d.photo),
        thumbnailUrl: PHOTO(d.photo),
        caption: "Exclusive late-night set 🌙",
        status: "approved",
        containsHookah: true,
        premium: true,
        tier: "photo",
        price: 4.99,
      },
      {
        dollId: doll.id,
        type: "premium_photo",
        url: PHOTO(d.photo),
        thumbnailUrl: PHOTO(d.photo),
        caption: "Full photo bundle — the whole shoot 📸",
        status: "approved",
        containsHookah: true,
        premium: true,
        tier: "bundle",
        price: 14.99,
      },
      {
        dollId: doll.id,
        type: "premium_video",
        url: PHOTO(d.photo),
        thumbnailUrl: PHOTO(d.photo),
        caption: "Smoke ring tutorial — premium clip",
        status: "approved",
        containsHookah: true,
        premium: true,
        tier: "video",
        price: 9.99,
      },
      {
        dollId: doll.id,
        type: "premium_video",
        url: PHOTO(d.photo),
        thumbnailUrl: PHOTO(d.photo),
        caption: "Exclusive 1-on-1 session — top tier ✨",
        status: "approved",
        containsHookah: true,
        premium: true,
        tier: "exclusive",
        price: 29.99,
      },
    ]);
  }
}

async function seedAdminAndMembers() {
  await db.insert(usersTable).values({
    role: "admin",
    name: "Platform Admin",
    email: "admin@hookahdolls.com",
    passwordHash: await hash("admin123"),
    accountStatus: "active",
    ageConfirmed: true,
    rulesAccepted: true,
  });

  const members: {
    name: string;
    email: string;
    purchased: number;
    membershipTier: "basic" | "premium" | null;
  }[] = [
    { name: "Marcus Lee", email: "marcus@example.com", purchased: 25, membershipTier: "basic" },
    { name: "David Chen", email: "david@example.com", purchased: 10, membershipTier: null },
  ];
  for (const m of members) {
    const [u] = await db
      .insert(usersTable)
      .values({
        role: "member",
        name: m.name,
        email: m.email,
        passwordHash: await hash("password123"),
        accountStatus: "active",
        ageConfirmed: true,
        rulesAccepted: true,
      })
      .returning();

    const monthlyCredits = m.membershipTier ? membershipMonthlyCredits(m.membershipTier) : 0;
    await db.insert(creditBalancesTable).values({
      userId: u.id,
      membershipBalance: monthlyCredits,
      purchasedBalance: m.purchased,
    });
    if (m.purchased > 0) {
      await db.insert(creditTransactionsTable).values({
        userId: u.id,
        amount: m.purchased,
        type: "purchase",
        description: "Welcome credit pack",
      });
    }
    if (m.membershipTier) {
      const [plan] = await db
        .select()
        .from(plansTable)
        .where(and(eq(plansTable.audience, "member"), eq(plansTable.tier, m.membershipTier)));
      if (plan) {
        await db.insert(subscriptionsTable).values({
          memberUserId: u.id,
          planId: plan.id,
          status: "active",
          currentPeriodEnd: nextBillingDate(),
        });
        await db.insert(creditTransactionsTable).values({
          userId: u.id,
          amount: monthlyCredits,
          type: "membership",
          description: `Monthly membership credits — ${plan.name}`,
        });
      }
    }
  }
}

function eqUser(id: number) {
  return eq(usersTable.id, id);
}

async function main() {
  console.log("Clearing existing data...");
  await clear();
  console.log("Seeding plans...");
  await seedPlans();
  console.log("Seeding credit packages...");
  await seedCreditPackages();
  console.log("Seeding dolls...");
  await seedDolls();
  console.log("Seeding admin and members...");
  await seedAdminAndMembers();
  console.log("Seed complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
