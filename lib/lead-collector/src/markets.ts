export interface MarketCity {
  city: string;
  state: string;
}

export interface Market {
  id: string;
  label: string;
  // Restrict accepted results to this county (administrative_area_level_2), if set.
  county?: string;
  // Restrict accepted results to these states.
  states: string[];
  cities: MarketCity[];
}

// First test market: Las Vegas / Clark County, NV.
export const LAS_VEGAS: Market = {
  id: "las-vegas",
  label: "Las Vegas / Clark County, NV",
  county: "Clark County",
  states: ["NV"],
  cities: [
    { city: "Las Vegas", state: "NV" },
    { city: "North Las Vegas", state: "NV" },
    { city: "Henderson", state: "NV" },
    { city: "Paradise", state: "NV" },
    { city: "Enterprise", state: "NV" },
    { city: "Summerlin", state: "NV" },
    { city: "Spring Valley", state: "NV" },
    { city: "Sunrise Manor", state: "NV" },
    { city: "Winchester", state: "NV" },
    { city: "Whitney", state: "NV" },
    { city: "Boulder City", state: "NV" },
  ],
};

// Nationwide master: major U.S. metros across all regions. Intentionally broad —
// running this is high-volume / high-cost, so it is opt-in only.
export const NATIONWIDE: Market = {
  id: "nationwide",
  label: "Nationwide (major U.S. metros)",
  states: [],
  cities: [
    { city: "New York", state: "NY" },
    { city: "Los Angeles", state: "CA" },
    { city: "Chicago", state: "IL" },
    { city: "Houston", state: "TX" },
    { city: "Phoenix", state: "AZ" },
    { city: "Philadelphia", state: "PA" },
    { city: "San Antonio", state: "TX" },
    { city: "San Diego", state: "CA" },
    { city: "Dallas", state: "TX" },
    { city: "Austin", state: "TX" },
    { city: "San Jose", state: "CA" },
    { city: "Jacksonville", state: "FL" },
    { city: "Fort Worth", state: "TX" },
    { city: "Columbus", state: "OH" },
    { city: "Charlotte", state: "NC" },
    { city: "San Francisco", state: "CA" },
    { city: "Indianapolis", state: "IN" },
    { city: "Seattle", state: "WA" },
    { city: "Denver", state: "CO" },
    { city: "Washington", state: "DC" },
    { city: "Boston", state: "MA" },
    { city: "Nashville", state: "TN" },
    { city: "Las Vegas", state: "NV" },
    { city: "Detroit", state: "MI" },
    { city: "Portland", state: "OR" },
    { city: "Memphis", state: "TN" },
    { city: "Atlanta", state: "GA" },
    { city: "Miami", state: "FL" },
    { city: "Orlando", state: "FL" },
    { city: "Tampa", state: "FL" },
    { city: "Minneapolis", state: "MN" },
    { city: "New Orleans", state: "LA" },
    { city: "Cleveland", state: "OH" },
    { city: "Kansas City", state: "MO" },
    { city: "Sacramento", state: "CA" },
    { city: "Salt Lake City", state: "UT" },
    { city: "Pittsburgh", state: "PA" },
    { city: "Cincinnati", state: "OH" },
    { city: "St. Louis", state: "MO" },
    { city: "Raleigh", state: "NC" },
    { city: "Richmond", state: "VA" },
    { city: "Baltimore", state: "MD" },
    { city: "Milwaukee", state: "WI" },
    { city: "Dearborn", state: "MI" },
    { city: "Houston", state: "TX" },
    { city: "Tucson", state: "AZ" },
    { city: "Fresno", state: "CA" },
    { city: "Louisville", state: "KY" },
    { city: "Albuquerque", state: "NM" },
    { city: "Oklahoma City", state: "OK" },
  ],
};

export const MARKETS: Record<string, Market> = {
  [LAS_VEGAS.id]: LAS_VEGAS,
  [NATIONWIDE.id]: NATIONWIDE,
};

export function getMarket(id: string): Market | undefined {
  return MARKETS[id];
}
