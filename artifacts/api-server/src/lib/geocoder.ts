import { createHash } from "node:crypto";

const DEFAULT_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const REQUEST_TIMEOUT_MS = 4_000;
const MIN_PROVIDER_INTERVAL_MS = 1_100;

export type GeocodeStatus =
  | "ready"
  | "ambiguous"
  | "unavailable"
  | "retryable";

export interface GeocodeOutcome {
  status: GeocodeStatus;
  lat: number | null;
  lng: number | null;
}

export interface BusinessAddress {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
}

interface ProviderResult {
  lat?: unknown;
  lon?: unknown;
  name?: unknown;
  type?: unknown;
  address?: {
    city?: unknown;
    town?: unknown;
    village?: unknown;
    municipality?: unknown;
    hamlet?: unknown;
    house_number?: unknown;
    road?: unknown;
    pedestrian?: unknown;
    residential?: unknown;
    state?: unknown;
    postcode?: unknown;
    country_code?: unknown;
    "ISO3166-2-lvl4"?: unknown;
  };
}

type Fetcher = typeof fetch;

const US_STATE_NAMES: Record<string, string> = {
  AL: "ALABAMA",
  AK: "ALASKA",
  AZ: "ARIZONA",
  AR: "ARKANSAS",
  CA: "CALIFORNIA",
  CO: "COLORADO",
  CT: "CONNECTICUT",
  DE: "DELAWARE",
  FL: "FLORIDA",
  GA: "GEORGIA",
  HI: "HAWAII",
  ID: "IDAHO",
  IL: "ILLINOIS",
  IN: "INDIANA",
  IA: "IOWA",
  KS: "KANSAS",
  KY: "KENTUCKY",
  LA: "LOUISIANA",
  ME: "MAINE",
  MD: "MARYLAND",
  MA: "MASSACHUSETTS",
  MI: "MICHIGAN",
  MN: "MINNESOTA",
  MS: "MISSISSIPPI",
  MO: "MISSOURI",
  MT: "MONTANA",
  NE: "NEBRASKA",
  NV: "NEVADA",
  NH: "NEW HAMPSHIRE",
  NJ: "NEW JERSEY",
  NM: "NEW MEXICO",
  NY: "NEW YORK",
  NC: "NORTH CAROLINA",
  ND: "NORTH DAKOTA",
  OH: "OHIO",
  OK: "OKLAHOMA",
  OR: "OREGON",
  PA: "PENNSYLVANIA",
  RI: "RHODE ISLAND",
  SC: "SOUTH CAROLINA",
  SD: "SOUTH DAKOTA",
  TN: "TENNESSEE",
  TX: "TEXAS",
  UT: "UTAH",
  VT: "VERMONT",
  VA: "VIRGINIA",
  WA: "WASHINGTON",
  WV: "WEST VIRGINIA",
  WI: "WISCONSIN",
  WY: "WYOMING",
  DC: "DISTRICT OF COLUMBIA",
};

let providerQueue: Promise<void> = Promise.resolve();
let nextProviderRequestAt = 0;

function normalize(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ").toUpperCase() ?? "";
}

function stateMatches(result: ProviderResult, expectedState: string): boolean {
  const expected = normalize(expectedState);
  const stateName = normalize(result.address?.state as string | undefined);
  const iso = normalize(result.address?.["ISO3166-2-lvl4"] as string | undefined);
  const expectedName = US_STATE_NAMES[expected] ?? expected;
  return stateName === expected || stateName === expectedName || iso === `US-${expected}`;
}

function cityMatches(result: ProviderResult, expectedCity: string): boolean {
  const expected = normalize(expectedCity);
  const address = result.address;
  const candidates = [
    address?.city,
    address?.town,
    address?.village,
    address?.municipality,
    address?.hamlet,
    result.name,
  ];
  return candidates.some(
    (candidate) => typeof candidate === "string" && normalize(candidate) === expected,
  );
}

function normalizeRoad(value: string | null | undefined): string {
  return normalize(value)
    .replace(/\bSTREET\b/g, "ST")
    .replace(/\bAVENUE\b/g, "AVE")
    .replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bROAD\b/g, "RD")
    .replace(/\bDRIVE\b/g, "DR")
    .replace(/\bLANE\b/g, "LN")
    .replace(/\bCOURT\b/g, "CT")
    .replace(/\bPARKWAY\b/g, "PKWY")
    .replace(/\bHIGHWAY\b/g, "HWY")
    .replace(/\bNORTH\b/g, "N")
    .replace(/\bSOUTH\b/g, "S")
    .replace(/\bEAST\b/g, "E")
    .replace(/\bWEST\b/g, "W")
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function streetAddressMatches(result: ProviderResult, inputAddress: string): boolean {
  const trimmed = inputAddress.trim();
  const numberMatch = trimmed.match(/^([0-9]+[A-Z]?(?:-[0-9]+)?)\s+(.+)$/i);
  if (!numberMatch) return false;
  const expectedNumber = normalize(numberMatch[1]);
  const expectedRoad = normalizeRoad(
    numberMatch[2].replace(
      /\s+(?:SUITE|STE|UNIT|APT|APARTMENT|#)\s*[A-Z0-9-]+.*$/i,
      "",
    ),
  );
  const resultNumber = normalize(result.address?.house_number as string | undefined);
  const resultRoad = normalizeRoad(
    (result.address?.road ??
      result.address?.pedestrian ??
      result.address?.residential) as string | undefined,
  );
  return (
    resultNumber === expectedNumber &&
    resultRoad.length > 0 &&
    resultRoad === expectedRoad
  );
}

function validCoordinates(result: ProviderResult): { lat: number; lng: number } | null {
  const lat = typeof result.lat === "string" ? Number(result.lat) : result.lat;
  const lng = typeof result.lon === "string" ? Number(result.lon) : result.lon;
  if (
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    typeof lng !== "number" ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

function distanceMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const radius = 3958.8;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      Math.sin(deltaLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function addressFingerprint(input: BusinessAddress): string {
  const normalized = [
    input.address,
    input.city,
    input.state,
    input.zip,
    input.country ?? "US",
  ]
    .map(normalize)
    .join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

export function selectCityGeocode(
  results: ProviderResult[],
  city: string,
  state: string,
): GeocodeOutcome {
  const matches = results
    .filter((result) => {
      const countryCode = normalize(result.address?.country_code as string | undefined);
      return (
        countryCode === "US" &&
        cityMatches(result, city) &&
        stateMatches(result, state) &&
        ["CITY", "TOWN", "VILLAGE", "MUNICIPALITY", "ADMINISTRATIVE"].includes(
          normalize(result.type as string | undefined),
        )
      );
    })
    .map(validCoordinates)
    .filter((value): value is { lat: number; lng: number } => value !== null);

  if (matches.length === 0) return { status: "unavailable", lat: null, lng: null };
  if (matches.some((match) => distanceMiles(matches[0], match) > 5)) {
    return { status: "ambiguous", lat: null, lng: null };
  }
  return { status: "ready", lat: matches[0].lat, lng: matches[0].lng };
}

export function selectBusinessGeocode(
  results: ProviderResult[],
  input: BusinessAddress,
): GeocodeOutcome {
  const expectedZip = normalize(input.zip).replace(/[^0-9]/g, "").slice(0, 5);
  const matches = results
    .filter((result) => {
      const countryCode = normalize(result.address?.country_code as string | undefined);
      const resultZip = normalize(result.address?.postcode as string | undefined)
        .replace(/[^0-9]/g, "")
        .slice(0, 5);
      return (
        countryCode === "US" &&
        cityMatches(result, input.city ?? "") &&
        stateMatches(result, input.state ?? "") &&
        streetAddressMatches(result, input.address ?? "") &&
        (!expectedZip || !resultZip || expectedZip === resultZip)
      );
    })
    .map(validCoordinates)
    .filter((value): value is { lat: number; lng: number } => value !== null);

  if (matches.length === 0) return { status: "unavailable", lat: null, lng: null };
  if (matches.some((match) => distanceMiles(matches[0], match) > 0.25)) {
    return { status: "ambiguous", lat: null, lng: null };
  }
  return { status: "ready", lat: matches[0].lat, lng: matches[0].lng };
}

async function waitForProviderSlot(): Promise<void> {
  const previous = providerQueue;
  let release: (() => void) | undefined;
  providerQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const waitMs = Math.max(0, nextProviderRequestAt - Date.now());
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  nextProviderRequestAt = Date.now() + MIN_PROVIDER_INTERVAL_MS;
  release?.();
}

async function searchProvider(
  query: string,
  fetcher: Fetcher,
): Promise<ProviderResult[] | null> {
  if (fetcher === fetch) await waitForProviderSlot();
  const endpoint = process.env.GEOCODER_BASE_URL?.trim() || DEFAULT_ENDPOINT;
  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("limit", "5");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const runtimeDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
    const userAgent =
      process.env.GEOCODER_USER_AGENT?.trim() ||
      (runtimeDomain ? `HookahDolls/1.0 (+https://${runtimeDomain})` : null) ||
      (fetcher !== fetch ? "HookahDolls-Test/1.0" : null);
    if (!userAgent) return null;
    const response = await fetcher(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": userAgent,
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return Array.isArray(body) ? (body as ProviderResult[]) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function geocodeCity(
  city: string,
  state: string,
  fetcher: Fetcher = fetch,
): Promise<GeocodeOutcome> {
  const results = await searchProvider(`${city}, ${state}, USA`, fetcher);
  if (results === null) return { status: "retryable", lat: null, lng: null };
  return selectCityGeocode(results, city, state);
}

export async function geocodeBusinessAddress(
  input: BusinessAddress,
  fetcher: Fetcher = fetch,
): Promise<GeocodeOutcome> {
  if (!normalize(input.address) || !normalize(input.city) || !normalize(input.state)) {
    return { status: "unavailable", lat: null, lng: null };
  }
  const query = [input.address, input.city, input.state, input.zip, input.country ?? "US"]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(", ");
  const results = await searchProvider(query, fetcher);
  if (results === null) return { status: "retryable", lat: null, lng: null };
  return selectBusinessGeocode(results, input);
}