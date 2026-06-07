// Thin wrapper around the Google Places API (New) Text Search endpoint.

export interface PlacesAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export interface PlaceResult {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: PlacesAddressComponent[];
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  priceLevel?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
}

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.priceLevel",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.googleMapsUri",
  "places.regularOpeningHours",
  "places.types",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_PLACES_API_KEY must be set to collect leads");
  }
  return key;
}

/**
 * Runs a single text query, following pagination up to `maxPages`.
 * Returns the combined list of place results.
 */
export async function searchText(
  textQuery: string,
  opts: { apiKey: string; maxPages?: number; throttleMs?: number } = {
    apiKey: "",
  },
): Promise<PlaceResult[]> {
  const apiKey = opts.apiKey || getApiKey();
  const maxPages = opts.maxPages ?? 3;
  const throttleMs = opts.throttleMs ?? 250;

  const results: PlaceResult[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = { textQuery, maxResultCount: 20 };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Places searchText failed (${res.status}) for "${textQuery}": ${text}`,
      );
    }

    const json = (await res.json()) as {
      places?: PlaceResult[];
      nextPageToken?: string;
    };
    if (json.places) results.push(...json.places);

    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
    // nextPageToken needs a brief delay before it becomes valid.
    await sleep(Math.max(throttleMs, 1500));
  }

  return results;
}
