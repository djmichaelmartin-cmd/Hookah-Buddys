import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  dollsTable,
  mediaTable,
  verificationsTable,
  plansTable,
  creditBalancesTable,
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
  await db.delete(loungesTable);
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
      description: "Everything in Free, plus enhanced messaging.",
      features: ["Browse profiles", "Save favorites", "Enhanced messaging"],
      highlighted: false,
    },
    {
      name: "Premium Membership",
      audience: "member",
      price: 39.99,
      interval: "month",
      tier: "premium",
      description: "The full experience with premium browsing and access.",
      features: ["Enhanced messaging", "Additional profile access", "Premium browsing features"],
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
        price: 4.99,
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
        price: 9.99,
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

  const members = [
    { name: "Marcus Lee", email: "marcus@example.com", balance: 25 },
    { name: "David Chen", email: "david@example.com", balance: 10 },
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
    await db.insert(creditBalancesTable).values({ userId: u.id, balance: m.balance });
    await db.insert(creditTransactionsTable).values({
      userId: u.id,
      amount: m.balance,
      type: "purchase",
      description: "Welcome credit pack",
    });
  }
}

function eqUser(id: number) {
  return eq(usersTable.id, id);
}

type LoungeSeed = {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  phone: string;
  website: string;
  description: string;
  rating: number;
  priceLevel: number;
  hours: string;
};

const LOUNGE_IMG =
  "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=900&q=70";

const LOUNGES: LoungeSeed[] = [
  { name: "Velvet Smoke Lounge", address: "120 Ludlow St", city: "New York", state: "NY", zip: "10002", lat: 40.7185, lng: -73.9876, phone: "(212) 555-0142", website: "https://example.com/velvet-smoke", description: "Lower East Side hookah den with rotating shisha flavors and late-night DJs.", rating: 4.6, priceLevel: 3, hours: "5 PM – 2 AM daily" },
  { name: "Cloud Nine Hookah Bar", address: "32 W 27th St", city: "New York", state: "NY", zip: "10001", lat: 40.7444, lng: -73.9889, phone: "(212) 555-0188", website: "https://example.com/cloud-nine", description: "NoMad rooftop lounge with skyline views and premium tobacco.", rating: 4.4, priceLevel: 3, hours: "6 PM – 3 AM daily" },
  { name: "Sahara Nights", address: "75 Newbury St", city: "Boston", state: "MA", zip: "02116", lat: 42.3505, lng: -71.0790, phone: "(617) 555-0119", website: "https://example.com/sahara-nights", description: "Back Bay Mediterranean lounge pairing mezze plates with fruit hookah.", rating: 4.5, priceLevel: 2, hours: "4 PM – 1 AM daily" },
  { name: "Mirage Hookah Lounge", address: "1420 South St", city: "Philadelphia", state: "PA", zip: "19146", lat: 39.9434, lng: -75.1660, phone: "(215) 555-0173", website: "https://example.com/mirage", description: "Cozy South Street lounge known for its signature mint-grape blend.", rating: 4.3, priceLevel: 2, hours: "5 PM – 2 AM daily" },
  { name: "Oasis Smoke & Tea", address: "1811 Adams Morgan", city: "Washington", state: "DC", zip: "20009", lat: 38.9215, lng: -77.0422, phone: "(202) 555-0156", website: "https://example.com/oasis-dc", description: "Adams Morgan tea house and hookah lounge with Turkish coffee.", rating: 4.5, priceLevel: 2, hours: "5 PM – 2 AM daily" },
  { name: "Casablanca Lounge", address: "210 NW 5th St", city: "Miami", state: "FL", zip: "33128", lat: 25.7780, lng: -80.1959, phone: "(305) 555-0101", website: "https://example.com/casablanca", description: "Downtown Miami Moroccan-themed lounge with hand-painted lanterns.", rating: 4.7, priceLevel: 3, hours: "7 PM – 4 AM daily" },
  { name: "Hookah Republic", address: "401 Ocean Dr", city: "Miami Beach", state: "FL", zip: "33139", lat: 25.7715, lng: -80.1320, phone: "(305) 555-0190", website: "https://example.com/hookah-republic", description: "South Beach beachfront lounge with ocean breezes and live oud.", rating: 4.4, priceLevel: 3, hours: "6 PM – 5 AM daily" },
  { name: "Pharaoh's Den", address: "560 Peachtree St NE", city: "Atlanta", state: "GA", zip: "30308", lat: 33.7700, lng: -84.3853, phone: "(404) 555-0148", website: "https://example.com/pharaohs-den", description: "Midtown Atlanta lounge with Egyptian decor and a deep flavor list.", rating: 4.5, priceLevel: 2, hours: "6 PM – 2 AM daily" },
  { name: "Aladdin Hookah Cafe", address: "2120 Greenville Ave", city: "Dallas", state: "TX", zip: "75206", lat: 32.8290, lng: -96.7700, phone: "(214) 555-0133", website: "https://example.com/aladdin", description: "Lower Greenville cafe with Persian sweets and shisha.", rating: 4.4, priceLevel: 2, hours: "5 PM – 2 AM daily" },
  { name: "Sultan's Lounge", address: "1201 Westheimer Rd", city: "Houston", state: "TX", zip: "77006", lat: 29.7430, lng: -95.3920, phone: "(713) 555-0166", website: "https://example.com/sultans", description: "Montrose lounge with private cabanas and craft mocktails.", rating: 4.6, priceLevel: 3, hours: "5 PM – 2 AM daily" },
  { name: "Nile Hookah Bar", address: "612 E 6th St", city: "Austin", state: "TX", zip: "78701", lat: 30.2670, lng: -97.7370, phone: "(512) 555-0124", website: "https://example.com/nile", description: "Dirty Sixth lounge with patio seating and live music weekends.", rating: 4.3, priceLevel: 2, hours: "6 PM – 2 AM daily" },
  { name: "Genie's Hookah Lounge", address: "300 E Bay St", city: "Charleston", state: "SC", zip: "29401", lat: 32.7860, lng: -79.9290, phone: "(843) 555-0112", website: "https://example.com/genies", description: "Historic downtown lounge with courtyard seating.", rating: 4.4, priceLevel: 2, hours: "6 PM – 1 AM daily" },
  { name: "Smoke & Mirrors", address: "401 N Michigan Ave", city: "Chicago", state: "IL", zip: "60611", lat: 41.8895, lng: -87.6244, phone: "(312) 555-0177", website: "https://example.com/smoke-mirrors", description: "River North lounge with skyline views and craft hookah blends.", rating: 4.5, priceLevel: 3, hours: "5 PM – 2 AM daily" },
  { name: "Arabian Nights Lounge", address: "1734 W Division St", city: "Chicago", state: "IL", zip: "60622", lat: 41.9035, lng: -87.6710, phone: "(312) 555-0145", website: "https://example.com/arabian-nights", description: "Wicker Park lounge with floor cushions and house mint tea.", rating: 4.2, priceLevel: 2, hours: "6 PM – 2 AM daily" },
  { name: "Desert Rose Hookah", address: "1015 Washington Ave", city: "Minneapolis", state: "MN", zip: "55401", lat: 44.9855, lng: -93.2560, phone: "(612) 555-0139", website: "https://example.com/desert-rose", description: "Warehouse District lounge with a heated winter patio.", rating: 4.3, priceLevel: 2, hours: "6 PM – 1 AM daily" },
  { name: "Phoenix Hookah Lounge", address: "2401 Main St", city: "Kansas City", state: "MO", zip: "64108", lat: 39.0820, lng: -94.5840, phone: "(816) 555-0151", website: "https://example.com/phoenix", description: "Crossroads arts-district lounge with local DJ nights.", rating: 4.4, priceLevel: 2, hours: "6 PM – 2 AM daily" },
  { name: "Bedouin Lounge", address: "1530 Blake St", city: "Denver", state: "CO", zip: "80202", lat: 39.7505, lng: -104.9990, phone: "(303) 555-0162", website: "https://example.com/bedouin", description: "LoDo lounge with mountain-view rooftop and craft shisha.", rating: 4.6, priceLevel: 3, hours: "5 PM – 2 AM daily" },
  { name: "Mystic Smoke Lounge", address: "55 W 200 S", city: "Salt Lake City", state: "UT", zip: "84101", lat: 40.7660, lng: -111.8910, phone: "(801) 555-0128", website: "https://example.com/mystic", description: "Downtown lounge with a relaxed vibe and herbal blends.", rating: 4.2, priceLevel: 2, hours: "6 PM – 12 AM daily" },
  { name: "Marrakesh Lounge", address: "8265 Sunset Blvd", city: "Los Angeles", state: "CA", zip: "90046", lat: 34.0955, lng: -118.3700, phone: "(323) 555-0109", website: "https://example.com/marrakesh", description: "Sunset Strip lounge with Moroccan tilework and bottle service.", rating: 4.7, priceLevel: 3, hours: "7 PM – 2 AM daily" },
  { name: "Hookah Palace LA", address: "11628 Santa Monica Blvd", city: "Los Angeles", state: "CA", zip: "90025", lat: 34.0395, lng: -118.4570, phone: "(310) 555-0185", website: "https://example.com/hookah-palace", description: "West LA lounge with 60+ flavors and late hours.", rating: 4.4, priceLevel: 2, hours: "6 PM – 4 AM daily" },
  { name: "Sahara Hookah Garden", address: "631 H St", city: "San Diego", state: "CA", zip: "92101", lat: 32.7155, lng: -117.1590, phone: "(619) 555-0117", website: "https://example.com/sahara-garden", description: "Gaslamp Quarter lounge with an open-air garden patio.", rating: 4.5, priceLevel: 2, hours: "6 PM – 2 AM daily" },
  { name: "Golden Hookah", address: "2223 Mission St", city: "San Francisco", state: "CA", zip: "94110", lat: 37.7615, lng: -122.4190, phone: "(415) 555-0193", website: "https://example.com/golden-hookah", description: "Mission District lounge with house-made fruit-bowl hookahs.", rating: 4.3, priceLevel: 3, hours: "6 PM – 1 AM daily" },
  { name: "Lotus Hookah Lounge", address: "1018 SW Stark St", city: "Portland", state: "OR", zip: "97205", lat: 45.5210, lng: -122.6820, phone: "(503) 555-0154", website: "https://example.com/lotus", description: "Downtown Portland lounge with vegan snacks and chill playlists.", rating: 4.4, priceLevel: 2, hours: "6 PM – 12 AM daily" },
  { name: "Emerald Smoke Lounge", address: "1426 1st Ave", city: "Seattle", state: "WA", zip: "98101", lat: 47.6090, lng: -122.3400, phone: "(206) 555-0171", website: "https://example.com/emerald", description: "Pike Place-area lounge with Sound views and herbal shisha.", rating: 4.3, priceLevel: 2, hours: "5 PM – 1 AM daily" },
  { name: "Neon Oasis", address: "3700 Las Vegas Blvd S", city: "Las Vegas", state: "NV", zip: "89109", lat: 36.1100, lng: -115.1750, phone: "(702) 555-0102", website: "https://example.com/neon-oasis", description: "Strip-side lounge open 24/7 with bottle service and DJs.", rating: 4.6, priceLevel: 3, hours: "Open 24 hours" },
  { name: "Mirage of the Desert", address: "4280 S Rainbow Blvd", city: "Las Vegas", state: "NV", zip: "89103", lat: 36.1110, lng: -115.2430, phone: "(702) 555-0196", website: "https://example.com/mirage-desert", description: "Off-Strip local favorite with affordable flavors and games.", rating: 4.4, priceLevel: 2, hours: "4 PM – 4 AM daily" },
  { name: "Cactus Hookah Lounge", address: "4221 N 7th Ave", city: "Phoenix", state: "AZ", zip: "85013", lat: 33.4955, lng: -112.0830, phone: "(602) 555-0137", website: "https://example.com/cactus", description: "Melrose-district lounge with misted patio for desert nights.", rating: 4.3, priceLevel: 2, hours: "6 PM – 2 AM daily" },
  { name: "Sphinx Hookah Lounge", address: "401 E Las Olas Blvd", city: "Fort Lauderdale", state: "FL", zip: "33301", lat: 26.1190, lng: -80.1390, phone: "(954) 555-0184", website: "https://example.com/sphinx", description: "Las Olas lounge with waterfront seating and craft shisha.", rating: 4.5, priceLevel: 3, hours: "6 PM – 2 AM daily" },
  { name: "Jasmine Hookah Cafe", address: "611 N Orange Ave", city: "Orlando", state: "FL", zip: "32801", lat: 28.5520, lng: -81.3790, phone: "(407) 555-0126", website: "https://example.com/jasmine", description: "Downtown Orlando cafe with arcade games and shisha.", rating: 4.2, priceLevel: 1, hours: "5 PM – 2 AM daily" },
  { name: "Crescent Moon Lounge", address: "1500 Frankford Ave", city: "New Orleans", state: "LA", zip: "70117", lat: 29.9650, lng: -90.0300, phone: "(504) 555-0143", website: "https://example.com/crescent-moon", description: "Bywater lounge with jazz nights and Creole-spiced mocktails.", rating: 4.5, priceLevel: 2, hours: "6 PM – 3 AM daily" },
  { name: "Istanbul Hookah House", address: "2547 Nicollet Ave", city: "Nashville", state: "TN", zip: "37203", lat: 36.1320, lng: -86.7850, phone: "(615) 555-0159", website: "https://example.com/istanbul", description: "Music City lounge with Turkish lamps and live acoustic sets.", rating: 4.4, priceLevel: 2, hours: "6 PM – 2 AM daily" },
  { name: "Royal Hookah Lounge", address: "1100 E Carson St", city: "Pittsburgh", state: "PA", zip: "15203", lat: 40.4290, lng: -79.9870, phone: "(412) 555-0175", website: "https://example.com/royal", description: "South Side lounge with billiards and a long flavor menu.", rating: 4.3, priceLevel: 2, hours: "6 PM – 2 AM daily" },
  { name: "Aurora Hookah Lounge", address: "1234 Euclid Ave", city: "Cleveland", state: "OH", zip: "44115", lat: 41.5010, lng: -81.6760, phone: "(216) 555-0168", website: "https://example.com/aurora", description: "Playhouse Square lounge with a relaxed downtown crowd.", rating: 4.2, priceLevel: 2, hours: "6 PM – 1 AM daily" },
  { name: "Zamani Hookah Lounge", address: "401 Monroe Ave", city: "Detroit", state: "MI", zip: "48226", lat: 42.3340, lng: -83.0430, phone: "(313) 555-0181", website: "https://example.com/zamani", description: "Greektown lounge with Lebanese mezze and premium tobacco.", rating: 4.5, priceLevel: 2, hours: "6 PM – 2 AM daily" },
];

async function seedLounges() {
  await db.insert(loungesTable).values(
    LOUNGES.map((l) => ({ ...l, imageUrl: LOUNGE_IMG })),
  );
}

async function main() {
  console.log("Clearing existing data...");
  await clear();
  console.log("Seeding plans...");
  await seedPlans();
  console.log("Seeding dolls...");
  await seedDolls();
  console.log("Seeding admin and members...");
  await seedAdminAndMembers();
  console.log("Seeding lounges...");
  await seedLounges();
  console.log("Seed complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
