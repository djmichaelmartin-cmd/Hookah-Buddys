import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useListMembers,
  getListMembersQueryKey,
  type ListMembersParams,
  type ListMembersBuddyType,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BuddyPill } from "@/components/BuddyPill";
import { Star, X, User } from "lucide-react";

export default function Browse() {
  const [buddyType, setBuddyType] = useState<ListMembersBuddyType | "all">("all");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");

  const ageError = useMemo(() => {
    const parseAge = (value: string, label: string) => {
      if (!value) return undefined;
      const age = Number(value);
      if (!Number.isInteger(age) || age < 18 || age > 120) {
        return `${label} age must be a whole number between 18 and 120.`;
      }
      return age;
    };

    const parsedMin = parseAge(minAge, "Minimum");
    if (typeof parsedMin === "string") return parsedMin;
    const parsedMax = parseAge(maxAge, "Maximum");
    if (typeof parsedMax === "string") return parsedMax;
    if (parsedMin !== undefined && parsedMax !== undefined && parsedMin > parsedMax) {
      return "Minimum age must be less than or equal to maximum age.";
    }
    return null;
  }, [minAge, maxAge]);

  const params = useMemo<ListMembersParams>(() => {
    const p: ListMembersParams = {};
    if (name.trim()) p.name = name.trim();
    if (handle.trim()) p.handle = handle.trim();
    if (!ageError && minAge) p.minAge = Number(minAge);
    if (!ageError && maxAge) p.maxAge = Number(maxAge);
    if (city.trim()) p.city = city.trim();
    if (state.trim()) p.state = state.trim();
    if (buddyType !== "all") p.buddyType = buddyType;
    return p;
  }, [name, handle, minAge, maxAge, city, state, buddyType, ageError]);

  const { data: buddys, isLoading, isError } = useListMembers(params, {
    query: { enabled: !ageError, queryKey: getListMembersQueryKey(params) }
  });

  const hasFilters =
    !!name ||
    !!handle ||
    !!minAge ||
    !!maxAge ||
    !!city ||
    !!state ||
    buddyType !== "all";

  const clearFilters = () => {
    setName("");
    setHandle("");
    setMinAge("");
    setMaxAge("");
    setCity("");
    setState("");
    setBuddyType("all");
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <div className="mb-8">
          <p className="text-primary uppercase tracking-[0.25em] text-xs font-semibold mb-3">
            The lineup
          </p>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-white">
            Browse Buddys
          </h1>
          <p className="text-muted-foreground mt-3">
            Discover and connect with Buddys across the community.
          </p>
        </div>

        {/* Filters */}
        <div className="mb-10 p-5 md:p-6 bg-card/50 border border-white/10 rounded-2xl backdrop-blur-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="f-buddy-type" className="text-xs text-muted-foreground mb-1.5 block">
                Buddy Type
              </Label>
              <Select value={buddyType} onValueChange={(v) => setBuddyType(v as ListMembersBuddyType | "all")}>
                <SelectTrigger id="f-buddy-type">
                  <SelectValue placeholder="All Buddys" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="female_buddy">Female Buddy</SelectItem>
                  <SelectItem value="male_buddy">Male Buddy</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="f-name" className="text-xs text-muted-foreground mb-1.5 block">
                Name
              </Label>
              <Input
                id="f-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Any name"
              />
            </div>
            <div>
              <Label htmlFor="f-handle" className="text-xs text-muted-foreground mb-1.5 block">
                Handle
              </Label>
              <Input
                id="f-handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="Any handle"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Age Range
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="f-min-age"
                  type="number"
                  inputMode="numeric"
                   min={18}
                   max={120}
                  value={minAge}
                  onChange={(e) => setMinAge(e.target.value)}
                  placeholder="Min"
                  aria-label="Minimum age"
                   aria-describedby="age-filter-error"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  id="f-max-age"
                  type="number"
                  inputMode="numeric"
                   min={18}
                   max={120}
                  value={maxAge}
                  onChange={(e) => setMaxAge(e.target.value)}
                  placeholder="Max"
                  aria-label="Maximum age"
                   aria-describedby="age-filter-error"
                />
              </div>
               {ageError && (
                 <p id="age-filter-error" className="mt-1.5 text-xs text-destructive" role="alert">
                   {ageError}
                 </p>
               )}
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

          {hasFilters && (
            <div className="mt-5 flex">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="ml-auto text-muted-foreground hover:text-white"
              >
                <X className="mr-1.5 h-4 w-4" /> Clear filters
              </Button>
            </div>
          )}
        </div>

        {/* Results */}
        {ageError ? (
          <div className="py-16 text-center">
            <p className="text-destructive">{ageError}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Adjust the age range to continue browsing.
            </p>
          </div>
        ) : isLoading ? (
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
              Something went wrong loading Buddys. Please try again.
            </p>
          </div>
        ) : !buddys || buddys.length === 0 ? (
          <div className="py-20 text-center">
            <Star className="mx-auto h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="text-xl font-serif text-white mb-2">No Buddys found</h3>
            <p className="text-muted-foreground text-sm">
              {hasFilters
                ? "Try adjusting or clearing your filters."
                : "Check back soon — new Buddys join the community often."}
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
              {buddys.length} {buddys.length === 1 ? "Buddy" : "Buddys"} to discover
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {buddys.map((buddy) => (
                <Link key={`${buddy.accountType}-${buddy.id}`} href={buddy.profileUrl} className="group block">
                  <div className="relative h-[300px] w-full rounded-2xl overflow-hidden mb-4 border border-white/5 group-hover:border-primary/50 transition-all duration-500 shadow-lg group-hover:shadow-[0_0_30px_rgba(24,119,242,0.15)] bg-card">
                    {buddy.profilePhotoUrl ? (
                      <img
                        src={buddy.profilePhotoUrl}
                        alt={buddy.name}
                        className="object-cover w-full h-full opacity-80 group-hover:opacity-100 transition-opacity"
                      />
                    ) : (
                      <div className="w-full h-full bg-card flex items-center justify-center">
                        <User className="w-12 h-12 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent opacity-80" />

                    <div className="absolute bottom-0 left-0 p-5 w-full">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-serif text-xl font-bold text-white truncate">
                          {buddy.name}
                        </h3>
                        <BuddyPill buddyType={buddy.buddyType} className="scale-[0.8] origin-left" />
                      </div>

                      <div className="text-sm text-muted-foreground space-y-0.5 mb-2">
                        {buddy.handle && <p className="text-primary truncate">@{buddy.handle}</p>}
                        {(buddy.city || buddy.state) && (
                          <p className="truncate">
                            {[buddy.city, buddy.state].filter(Boolean).join(", ")}
                          </p>
                        )}
                        {buddy.age != null && (
                          <p>{buddy.age} years old</p>
                        )}
                      </div>
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
