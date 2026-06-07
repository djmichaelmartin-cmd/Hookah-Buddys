import { useMemo, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useListLounges,
  type ListLoungesParams,
  type Lounge,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MapPin,
  Search,
  Phone,
  Globe,
  Star,
  Clock,
  Navigation,
  Loader2,
  X,
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet's default marker icon paths (they break under bundlers like Vite).
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

type Coords = { lat: number; lng: number };

// Recenters / refits the map whenever the result set changes.
function MapController({
  lounges,
  origin,
}: {
  lounges: Lounge[];
  origin: Coords | null;
}) {
  const map = useMap();
  const points: [number, number][] = [
    ...lounges.map((l) => [l.lat, l.lng] as [number, number]),
    ...(origin ? [[origin.lat, origin.lng] as [number, number]] : []),
  ];
  // Keep the dependency stable across renders without an effect.
  const key = points.map((p) => p.join(",")).join("|") || "empty";
  const lastKey = useRef<string>("");
  if (key !== lastKey.current) {
    lastKey.current = key;
    if (points.length === 0) {
      map.setView([39.8283, -98.5795], 4); // geographic center of the US
    } else if (points.length === 1) {
      map.setView(points[0], 11);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 12 });
    }
  }
  return null;
}

function priceLabel(level: number): string {
  if (!level) return "";
  return "$".repeat(Math.min(level, 3));
}

export default function Lounges() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [origin, setOrigin] = useState<Coords | null>(null);
  const [radius, setRadius] = useState<string>("50");
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const params = useMemo<ListLoungesParams>(() => {
    const p: ListLoungesParams = {};
    if (submittedQuery.trim()) p.q = submittedQuery.trim();
    if (stateFilter !== "all") p.state = stateFilter;
    if (origin) {
      p.lat = origin.lat;
      p.lng = origin.lng;
      if (radius) p.radius = Number(radius);
    }
    return p;
  }, [submittedQuery, stateFilter, origin, radius]);

  const { data, isLoading, isError } = useListLounges(params);
  const lounges = data ?? [];

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setGeoError("Location is not supported by your browser.");
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStateFilter("all");
        setGeoLoading(false);
      },
      () => {
        setGeoError("Could not get your location. Please allow location access.");
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const clearLocation = () => {
    setOrigin(null);
    setGeoError(null);
  };

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedQuery(query);
  };

  const mapCenter: [number, number] = origin
    ? [origin.lat, origin.lng]
    : [39.8283, -98.5795]; // geographic center of the US

  return (
    <Layout>
      <div className="bg-background">
        {/* Hero */}
        <section className="relative border-b border-white/10 bg-gradient-to-b from-card/60 to-background py-16">
          <div className="container mx-auto px-4 text-center">
            <p className="mb-3 text-sm font-medium uppercase tracking-[0.3em] text-primary/80">
              Lounge Finder
            </p>
            <h1 className="font-serif text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary via-[#F3E5AB] to-rose-400">
              Find Hookah Lounges Near You
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Discover the best hookah lounges across the United States. Search by
              name or city, filter by state, or use your location to find spots
              nearby.
            </p>
          </div>
        </section>

        <div className="container mx-auto px-4 py-10">
          {/* Search controls */}
          <div className="rounded-2xl border border-white/10 bg-card/40 p-4 md:p-6 backdrop-blur">
            <form
              onSubmit={onSearch}
              className="flex flex-col gap-3 md:flex-row md:items-center"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by lounge name or city…"
                  className="pl-9"
                />
              </div>

              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger className="md:w-40">
                  <SelectValue placeholder="All states" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">All states</SelectItem>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button type="submit" className="md:w-auto">
                <Search className="mr-2 h-4 w-4" />
                Search
              </Button>
            </form>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {origin ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-sm text-primary">
                    <Navigation className="h-3.5 w-3.5" />
                    Near your location
                    <button
                      type="button"
                      onClick={clearLocation}
                      className="ml-1 rounded-full hover:text-white"
                      aria-label="Clear location"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                  <Select value={radius} onValueChange={setRadius}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">Within 10 mi</SelectItem>
                      <SelectItem value="25">Within 25 mi</SelectItem>
                      <SelectItem value="50">Within 50 mi</SelectItem>
                      <SelectItem value="100">Within 100 mi</SelectItem>
                      <SelectItem value="500">Within 500 mi</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={useMyLocation}
                  disabled={geoLoading}
                >
                  {geoLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Navigation className="mr-2 h-4 w-4" />
                  )}
                  Use my location
                </Button>
              )}
              {geoError && (
                <span className="text-sm text-destructive">{geoError}</span>
              )}
            </div>
          </div>

          {/* Map + results */}
          <div className="mt-8 grid gap-6 lg:grid-cols-5">
            {/* Map */}
            <div className="lg:col-span-3 order-1 lg:order-2">
              <div className="sticky top-28 h-[420px] lg:h-[600px] overflow-hidden rounded-2xl border border-white/10">
                <MapContainer
                  center={mapCenter}
                  zoom={origin ? 10 : 4}
                  scrollWheelZoom
                  className="h-full w-full"
                  style={{ background: "#0a0a0a" }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  />
                  {origin && (
                    <Marker position={[origin.lat, origin.lng]}>
                      <Popup>You are here</Popup>
                    </Marker>
                  )}
                  {lounges.map((l) => (
                    <Marker key={l.id} position={[l.lat, l.lng]}>
                      <Popup>
                        <strong>{l.name}</strong>
                        <br />
                        {l.address}, {l.city}, {l.state}
                      </Popup>
                    </Marker>
                  ))}
                  <MapController lounges={lounges} origin={origin} />
                </MapContainer>
              </div>
            </div>

            {/* Results list */}
            <div className="lg:col-span-2 order-2 lg:order-1">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-serif text-xl text-foreground">
                  {isLoading
                    ? "Searching…"
                    : `${lounges.length} lounge${lounges.length === 1 ? "" : "s"} found`}
                </h2>
              </div>

              {isError && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                  Something went wrong loading lounges. Please try again.
                </p>
              )}

              {!isLoading && !isError && lounges.length === 0 && (
                <p className="rounded-lg border border-white/10 bg-card/40 p-6 text-center text-muted-foreground">
                  No lounges match your search. Try a different city or widen your
                  radius.
                </p>
              )}

              <div className="space-y-4 lg:max-h-[600px] lg:overflow-y-auto lg:pr-2">
                {lounges.map((l) => (
                  <article
                    key={l.id}
                    className="overflow-hidden rounded-xl border border-white/10 bg-card/40 transition-colors hover:border-primary/40"
                  >
                    <div className="flex">
                      {l.imageUrl && (
                        <img
                          src={l.imageUrl}
                          alt={l.name}
                          loading="lazy"
                          className="h-auto w-28 shrink-0 object-cover"
                        />
                      )}
                      <div className="flex-1 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-serif text-lg leading-tight text-foreground">
                            {l.name}
                          </h3>
                          {typeof l.distanceMiles === "number" && (
                            <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                              {l.distanceMiles.toFixed(1)} mi
                            </span>
                          )}
                        </div>

                        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          {l.address ? `${l.address}, ` : ""}
                          {l.city}, {l.state} {l.zip}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {!!l.rating && (
                            <span className="inline-flex items-center gap-1 text-primary">
                              <Star className="h-3.5 w-3.5 fill-current" />
                              {l.rating.toFixed(1)}
                            </span>
                          )}
                          {!!l.priceLevel && <span>{priceLabel(l.priceLevel)}</span>}
                          {l.hours && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              {l.hours}
                            </span>
                          )}
                        </div>

                        {l.description && (
                          <p className="mt-2 text-sm text-muted-foreground/90 line-clamp-2">
                            {l.description}
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-3 text-sm">
                          {l.phone && (
                            <a
                              href={`tel:${l.phone}`}
                              className="inline-flex items-center gap-1.5 text-primary hover:underline"
                            >
                              <Phone className="h-3.5 w-3.5" />
                              {l.phone}
                            </a>
                          )}
                          {l.website && (
                            <a
                              href={l.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-primary hover:underline"
                            >
                              <Globe className="h-3.5 w-3.5" />
                              Website
                            </a>
                          )}
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-primary hover:underline"
                          >
                            <Navigation className="h-3.5 w-3.5" />
                            Directions
                          </a>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
