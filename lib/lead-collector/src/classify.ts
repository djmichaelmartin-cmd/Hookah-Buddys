import type { PlaceResult } from "./places";

export type ValidationStatus =
  | "confirmed"
  | "likely"
  | "needs_manual"
  | "closed";

export interface NormalizedLead {
  placeId: string;
  name: string;
  category: string;
  primaryType: string | null;
  types: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  phone: string | null;
  website: string | null;
  googleMapsUrl: string | null;
  lat: number | null;
  lng: number | null;
  businessStatus: string | null;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  hours: string | null;
  confidence: number;
  validationStatus: ValidationStatus;
}

const HOOKAH_TYPES = new Set(["hookah_bar"]);
const SMOKE_SHOP_TYPES = new Set(["smoke_shop", "tobacco_shop"]);

function component(
  place: PlaceResult,
  type: string,
  field: "longText" | "shortText" = "longText",
): string | null {
  const c = place.addressComponents?.find((a) => a.types?.includes(type));
  return c?.[field] ?? null;
}

function mapPriceLevel(level?: string): number | null {
  switch (level) {
    case "PRICE_LEVEL_FREE":
      return 0;
    case "PRICE_LEVEL_INEXPENSIVE":
      return 1;
    case "PRICE_LEVEL_MODERATE":
      return 2;
    case "PRICE_LEVEL_EXPENSIVE":
      return 3;
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return 4;
    default:
      return null;
  }
}

export function deriveCategory(place: PlaceResult): string {
  const types = place.types ?? [];
  const name = (place.displayName?.text ?? "").toLowerCase();
  const has = (t: string) => types.includes(t);

  if (types.some((t) => SMOKE_SHOP_TYPES.has(t)) || name.includes("smoke shop"))
    return "Smoke Shop";
  if (types.some((t) => HOOKAH_TYPES.has(t))) return "Hookah Lounge/Bar";
  if (name.includes("hookah") || name.includes("shisha"))
    return "Hookah Lounge/Bar";
  if (has("night_club")) return "Nightclub";
  if (has("bar") || has("lounge_bar")) return "Bar/Lounge";
  if (has("restaurant") || has("cafe") || has("food")) return "Restaurant/Cafe";
  return place.primaryTypeDisplayName?.text ?? "Other";
}

/** True if the place has an explicit hookah signal (type or name keyword). */
export function hasHookahSignal(place: PlaceResult): boolean {
  const types = place.types ?? [];
  const name = (place.displayName?.text ?? "").toLowerCase();
  if (types.some((t) => HOOKAH_TYPES.has(t))) return true;
  if (/hookah|shisha|narghile|nargila|sheesha/.test(name)) return true;
  return false;
}

/** True if the place is worth keeping as a lead (vs. a loosely-matched result). */
export function isHookahRelevant(place: PlaceResult): boolean {
  if (hasHookahSignal(place)) return true;
  // Lounges / bars / nightclubs / smoke shops are plausible hookah venues, so
  // they are kept — but without an explicit signal they remain "needs_manual"
  // (see deriveValidationStatus) and are never auto-promoted.
  const types = place.types ?? [];
  if (
    types.some(
      (t) =>
        t === "bar" ||
        t === "lounge_bar" ||
        t === "night_club" ||
        SMOKE_SHOP_TYPES.has(t),
    )
  )
    return true;
  return false;
}

function isClosed(place: PlaceResult): boolean {
  const s = place.businessStatus;
  return s === "CLOSED_PERMANENTLY" || s === "CLOSED_TEMPORARILY";
}

/** 0-100 confidence score from the strength of available signals. */
export function scoreConfidence(place: PlaceResult): number {
  const types = place.types ?? [];
  const name = (place.displayName?.text ?? "").toLowerCase();
  let score = 0;
  if (types.some((t) => HOOKAH_TYPES.has(t))) score += 35;
  if (/hookah|shisha|sheesha/.test(name)) score += 25;
  if (place.nationalPhoneNumber) score += 10;
  if (place.websiteUri) score += 10;
  if ((place.userRatingCount ?? 0) >= 5) score += 10;
  else if ((place.userRatingCount ?? 0) > 0) score += 4;
  if (typeof place.rating === "number") score += 5;
  if (component(place, "postal_code")) score += 5;
  return Math.min(100, score);
}

export function deriveValidationStatus(
  place: PlaceResult,
  confidence: number,
): ValidationStatus {
  if (isClosed(place)) return "closed";
  // Without an explicit hookah signal (e.g. a generic bar/nightclub returned by
  // a hookah search), never auto-promote — flag for manual review instead.
  if (!hasHookahSignal(place)) return "needs_manual";
  const hasContact = !!place.nationalPhoneNumber && !!place.websiteUri;
  if (confidence >= 70 && hasContact) return "confirmed";
  if (confidence >= 45) return "likely";
  return "needs_manual";
}

export function normalize(place: PlaceResult, sourceQuery: string): NormalizedLead {
  const confidence = scoreConfidence(place);
  return {
    placeId: place.id,
    name: place.displayName?.text ?? "Unknown",
    category: deriveCategory(place),
    primaryType: place.primaryType ?? null,
    types: place.types ? JSON.stringify(place.types) : null,
    address: place.formattedAddress ?? null,
    city: component(place, "locality"),
    state: component(place, "administrative_area_level_1", "shortText"),
    zip: component(place, "postal_code"),
    county: component(place, "administrative_area_level_2"),
    phone: place.nationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,
    googleMapsUrl: place.googleMapsUri ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    businessStatus: place.businessStatus ?? null,
    rating: typeof place.rating === "number" ? place.rating : null,
    reviewCount: place.userRatingCount ?? null,
    priceLevel: mapPriceLevel(place.priceLevel),
    hours: place.regularOpeningHours?.weekdayDescriptions?.join("; ") ?? null,
    confidence,
    validationStatus: deriveValidationStatus(place, confidence),
  };
}

// --- Dedup key normalization ---

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits || null;
}

export function normalizeNameAddress(
  name: string | null | undefined,
  address: string | null | undefined,
): string | null {
  const n = (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = (address ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!n && !a) return null;
  return `${n}|${a}`;
}
