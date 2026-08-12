import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useListDolls,
  type ListDollsParams,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Star, X, Video, Circle, ArrowRight } from "lucide-react";

export default function Browse() {
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [videoChatOnly, setVideoChatOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const params = useMemo<ListDollsParams>(() => {
    const p: ListDollsParams = {};
    const min = parseInt(minAge, 10);
    const max = parseInt(maxAge, 10);
    if (!Number.isNaN(min)) p.minAge = min;
    if (!Number.isNaN(max)) p.maxAge = max;
    if (city.trim()) p.city = city.trim();
    if (state.trim()) p.state = state.trim();
    if (onlineOnly) p.online = true;
    if (videoChatOnly) p.videoChat = true;
    if (verifiedOnly) p.verified = true;
    return p;
  }, [minAge, maxAge, city, state, onlineOnly, videoChatOnly, verifiedOnly]);

  const { data: dolls, isLoading, isError } = useListDolls(params);

  const hasFilters =
    !!minAge ||
    !!maxAge ||
    !!city ||
    !!state ||
    onlineOnly ||
    videoChatOnly ||
    verifiedOnly;

  const clearFilters = () => {
    setMinAge("");
    setMaxAge("");
    setCity("");
    setState("");
    setOnlineOnly(false);
    setVideoChatOnly(false);
    setVerifiedOnly(false);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <div className="mb-8">
          <p className="text-primary uppercase tracking-[0.25em] text-xs font-semibold mb-3">
            The lineup
          </p>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-white">
            Browse the Lounge
          </h1>
        </div>

        {/* Filters */}
        <div className="mb-10 p-5 md:p-6 bg-card/50 border border-white/10 rounded-2xl backdrop-blur-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Age Range
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="f-min-age"
                  type="number"
                  inputMode="numeric"
                  min={21}
                  value={minAge}
                  onChange={(e) => setMinAge(e.target.value)}
                  placeholder="Min"
                  aria-label="Minimum age"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  id="f-max-age"
                  type="number"
                  inputMode="numeric"
                  min={21}
                  value={maxAge}
                  onChange={(e) => setMaxAge(e.target.value)}
                  placeholder="Max"
                  aria-label="Maximum age"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="f-city" className="text-xs text-muted-foreground mb-1.5 block">
                City
              </Label>
              <Input
                id="f-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Any city"
              />
            </div>
            <div>
              <Label htmlFor="f-state" className="text-xs text-muted-foreground mb-1.5 block">
                State
              </Label>
              <Input
                id="f-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="Any state"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex items-center gap-2.5">
              <Switch id="f-online" checked={onlineOnly} onCheckedChange={setOnlineOnly} />
              <Label htmlFor="f-online" className="flex items-center gap-1.5 text-sm text-zinc-300 cursor-pointer">
                <Circle className="h-2.5 w-2.5 fill-green-400 text-green-400" /> Online now
              </Label>
            </div>
            <div className="flex items-center gap-2.5">
              <Switch id="f-video" checked={videoChatOnly} onCheckedChange={setVideoChatOnly} />
              <Label htmlFor="f-video" className="flex items-center gap-1.5 text-sm text-zinc-300 cursor-pointer">
                <Video className="h-4 w-4 text-primary" /> Available for video
              </Label>
            </div>
            <div className="flex items-center gap-2.5">
              <Switch id="f-verified" checked={verifiedOnly} onCheckedChange={setVerifiedOnly} />
              <Label htmlFor="f-verified" className="flex items-center gap-1.5 text-sm text-zinc-300 cursor-pointer">
                <ShieldCheck className="h-4 w-4 text-primary" /> Verified only
              </Label>
            </div>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="ml-auto text-muted-foreground hover:text-white"
              >
                <X className="mr-1.5 h-4 w-4" /> Clear filters
              </Button>
            )}
          </div>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-[300px] w-full rounded-2xl bg-card/50 border border-white/5 animate-pulse"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="py-20 text-center">
            <p className="text-muted-foreground">
              Something went wrong loading the lounge. Please try again.
            </p>
          </div>
        ) : !dolls || dolls.length === 0 ? (
          <div className="py-20 text-center">
            <Star className="mx-auto h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="text-xl font-serif text-white mb-2">No Dolls found</h3>
            <p className="text-muted-foreground text-sm">
              {hasFilters
                ? "Try adjusting or clearing your filters."
                : "Check back soon — new Dolls join the lounge often."}
            </p>
            {hasFilters && (
              <Button variant="outline" onClick={clearFilters} className="mt-6">
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-5">
              {dolls.length} {dolls.length === 1 ? "Doll" : "Dolls"} in the lounge
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {dolls.map((doll) => (
                <Link key={doll.id} href={`/dolls/${doll.id}`} className="group block">
                  <div className="relative h-[300px] w-full rounded-2xl overflow-hidden mb-4 border border-white/5 group-hover:border-primary/50 transition-all duration-500 shadow-lg group-hover:shadow-[0_0_30px_rgba(0,90,156,0.2)] bg-card">
                    {doll.profilePhotoUrl ? (
                      <img
                        src={doll.profilePhotoUrl}
                        alt={doll.stageName}
                        className="object-cover w-full h-full opacity-80 group-hover:opacity-100 transition-opacity"
                      />
                    ) : (
                      <div className="w-full h-full bg-card flex items-center justify-center">
                        <Star className="w-12 h-12 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent opacity-80" />

                    <div className="absolute top-3 left-3 flex flex-col gap-2 items-start">
                      {doll.featured && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/25 border border-secondary/50 px-2.5 py-1 text-[10px] font-medium text-secondary backdrop-blur-md">
                          <Star className="h-3 w-3 fill-current" /> Featured
                        </span>
                      )}
                      {doll.verified && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 border border-primary/40 px-2.5 py-1 text-[10px] font-medium text-primary backdrop-blur-md">
                          <ShieldCheck className="h-3 w-3" /> Verified
                        </span>
                      )}
                    </div>

                    <div className="absolute top-3 right-3 flex flex-col gap-2 items-end">
                      {doll.online && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/20 border border-green-500/40 px-2.5 py-1 text-[10px] font-medium text-green-300 backdrop-blur-md">
                          <Circle className="h-2 w-2 fill-green-400 text-green-400" /> Online
                        </span>
                      )}
                      {doll.availableForVideoChat && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 border border-primary/40 px-2.5 py-1 text-[10px] font-medium text-primary backdrop-blur-md">
                          <Video className="h-3 w-3" /> Video
                        </span>
                      )}
                    </div>

                    <div className="absolute bottom-0 left-0 p-5 w-full">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-serif text-xl font-bold text-white">
                          {doll.stageName}
                        </h3>
                        {doll.verified && <ShieldCheck className="w-4 h-4 text-primary" />}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {doll.city}, {doll.state}
                      </p>
                      <Button
                        size="sm"
                        className="mt-3 w-full bg-white/10 hover:bg-primary text-white hover:text-primary-foreground border border-white/15 hover:border-primary backdrop-blur-md font-medium tracking-wide uppercase text-[11px] transition-all"
                      >
                        View Profile <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
