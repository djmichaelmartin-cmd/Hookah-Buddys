import { describe, expect, it, vi } from "vitest";
import {
  addressFingerprint,
  geocodeBusinessAddress,
  geocodeCity,
  selectBusinessGeocode,
  selectCityGeocode,
} from "../lib/geocoder";

const austin = {
  lat: "30.2672",
  lon: "-97.7431",
  name: "Austin",
  type: "city",
  address: {
    city: "Austin",
    state: "Texas",
    postcode: "78701",
    country_code: "us",
    "ISO3166-2-lvl4": "US-TX",
  },
};

const congressAddress = {
  ...austin,
  type: "house",
  address: {
    ...austin.address,
    house_number: "100",
    road: "Congress Avenue",
  },
};

describe("city geocoding", () => {
  it("accepts one validated US city/state result", () => {
    expect(selectCityGeocode([austin], "Austin", "TX")).toEqual({
      status: "ready",
      lat: 30.2672,
      lng: -97.7431,
    });
  });

  it("rejects mismatches and geographically ambiguous matches", () => {
    expect(selectCityGeocode([austin], "Dallas", "TX")).toEqual({
      status: "unavailable",
      lat: null,
      lng: null,
    });
    expect(
      selectCityGeocode(
        [
          austin,
          {
            ...austin,
            lat: "31.2672",
            lon: "-97.7431",
          },
        ],
        "Austin",
        "TX",
      ),
    ).toEqual({ status: "ambiguous", lat: null, lng: null });
  });

  it("sends city/state only from the server and returns no provider metadata", async () => {
    const fetcher = vi.fn(async (request: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(request));
      expect(url.searchParams.get("q")).toBe("Austin, TX, USA");
      expect(url.searchParams.get("countrycodes")).toBe("us");
      return new Response(JSON.stringify([austin]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const outcome = await geocodeCity("Austin", "TX", fetcher);
    expect(outcome).toEqual({ status: "ready", lat: 30.2672, lng: -97.7431 });
    expect(Object.keys(outcome).sort()).toEqual(["lat", "lng", "status"]);
  });
});

describe("business address geocoding", () => {
  const address = {
    address: "100 Congress Ave",
    city: "Austin",
    state: "TX",
    zip: "78701",
    country: "US",
  };

  it("requires the returned city/state and rejects conflicting coordinates", () => {
    expect(selectBusinessGeocode([austin], address)).toEqual({
      status: "unavailable",
      lat: null,
      lng: null,
    });
    expect(selectBusinessGeocode([congressAddress], address)).toEqual({
      status: "ready",
      lat: 30.2672,
      lng: -97.7431,
    });
    expect(
      selectBusinessGeocode(
        [
          congressAddress,
          {
            ...congressAddress,
            address: { ...congressAddress.address, city: "Dallas" },
          },
        ],
        address,
      ),
    ).toEqual({ status: "ready", lat: 30.2672, lng: -97.7431 });
    expect(
      selectBusinessGeocode(
        [
          congressAddress,
          { ...congressAddress, lat: "30.8", lon: "-97.7431" },
        ],
        address,
      ),
    ).toEqual({ status: "ambiguous", lat: null, lng: null });
  });

  it("does not call the provider without a complete street/city/state", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const outcome = await geocodeBusinessAddress(
      { ...address, address: null },
      fetcher,
    );
    expect(outcome).toEqual({ status: "unavailable", lat: null, lng: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stores a stable one-way fingerprint rather than a duplicate raw address", () => {
    const fingerprint = addressFingerprint(address);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain("Congress");
    expect(fingerprint).toBe(addressFingerprint({ ...address }));
    expect(fingerprint).not.toBe(
      addressFingerprint({ ...address, zip: "78702" }),
    );
  });
});