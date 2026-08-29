import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useGetCurrentUser,
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
import { User, MapPin, X, Users, ArrowRight, CalendarDays } from "lucide-react";
import { BuddyPill } from "@/components/BuddyPill";

export default function MembersDirectory() {
  const { data: session, isLoading: loadingSession } = useGetCurrentUser();
  const role = session?.user?.role;
  const canView = role === "doll" || role === "admin";

  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [buddyType, setBuddyType] = useState<ListMembersBuddyType | "all">("all");

  const params = useMemo<ListMembersParams>(() => {
    const p: ListMembersParams = {};
    if (search.trim()) p.search = search.trim();
    if (city.trim()) p.city = city.trim();
    if (state.trim()) p.state = state.trim();
    if (buddyType !== "all") p.buddyType = buddyType;
    return p;
  }, [search, city, state, buddyType]);

  const {
    data: members,
    isLoading,
    isError,
  } = useListMembers(params, {
    query: { enabled: canView, queryKey: getListMembersQueryKey(params) },
  });

  const hasFilters = !!search || !!city || !!state || buddyType !== "all";

  const clearFilters = () => {
    setSearch("");
    setCity("");
    setState("");
    setBuddyType("all");
  };

  if (loadingSession)
    return (
      <Layout>
        <div className="container p-12 text-center text-muted-foreground">Loading...</div>
      </Layout>
    );

  if (!canView)
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 text-center max-w-lg">
          <Users className="mx-auto h-10 w-10 text-muted-foreground/30 mb-4" />
          <h1 className="text-2xl font-serif text-white mb-2">Buddys only</h1>
          <p className="text-muted-foreground text-sm">

            The member directory is available to verified Buddys. Sign in with your Buddy account to
            browse members.
          </p>
          <Link href="/login">
            <Button variant="outline" className="mt-6">
              Go to login
            </Button>
          </Link>
        </div>
      </Layout>
    );

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <div className="mb-8">
          <p className="text-primary uppercase tracking-[0.25em] text-xs font-semibold mb-3">
            Your audience
          </p>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-white">Member Directory</h1>
          <p className="text-muted-foreground mt-3">Browse and search every member on the platform.</p>
        </div>

        {/* Filters */}
        <div className="mb-10 p-5 md:p-6 bg-card/50 border border-white/10 rounded-2xl backdrop-blur-sm">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="m-search" className="text-xs text-muted-foreground mb-1.5 block">
                Name or username
              </Label>
              <Input
                id="m-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search members"
              />
            </div>
            <div>
              <Label htmlFor="m-city" className="text-xs text-muted-foreground mb-1.5 block">
                City
              </Label>
              <Input
                id="m-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Any city"
              />
            </div>
            <div>
              <Label htmlFor="m-state" className="text-xs text-muted-foreground mb-1.5 block">
                State
              </Label>
              <Input
                id="m-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="Any state"
              />
            </div>
            <div>
              <Label htmlFor="m-buddy-type" className="text-xs text-muted-foreground mb-1.5 block">
                Buddy Type
              </Label>
              <Select value={buddyType} onValueChange={(v) => setBuddyType(v as ListMembersBuddyType | "all")}>
                <SelectTrigger id="m-buddy-type">
                  <SelectValue placeholder="All Buddys" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="female_buddy">Female Buddy</SelectItem>
                  <SelectItem value="male_buddy">Male Buddy</SelectItem>
                </SelectContent>
              </Select>
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
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[120px] w-full rounded-2xl bg-card/50 border border-white/5 animate-pulse"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="py-20 text-center">
            <p className="text-muted-foreground">
              Something went wrong loading members. Please try again.
            </p>
          </div>
        ) : !members || members.length === 0 ? (
          <div className="py-20 text-center">
            <Users className="mx-auto h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="text-xl font-serif text-white mb-2">No members found</h3>
            <p className="text-muted-foreground text-sm">
              {hasFilters ? "Try adjusting or clearing your filters." : "No members yet."}
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
              {members.length} {members.length === 1 ? "member" : "members"}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {members.map((member) => {
                const location = [member.city, member.state].filter(Boolean).join(", ");
                const memberSince = member.memberSince
                  ? new Date(member.memberSince).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                    })
                  : null;
                return (
                  <Link key={member.id} href={`/members/${member.id}`} className="group block">
                    <div className="flex items-center gap-4 p-5 rounded-2xl bg-card/50 border border-white/10 group-hover:border-primary/50 transition-all duration-300 group-hover:shadow-[0_0_24px_rgba(24,119,242,0.15)]">
                      <div className="w-16 h-16 rounded-full overflow-hidden border border-white/10 bg-card shrink-0 flex items-center justify-center">
                        {member.profilePhotoUrl ? (
                          <img
                            src={member.profilePhotoUrl}
                            alt={member.name}
                            className="object-cover w-full h-full"
                          />
                        ) : (
                          <User className="w-7 h-7 text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-serif text-lg font-bold text-white truncate max-w-[200px]">
                            {member.name}
                          </h3>
                          <BuddyPill buddyType={member.buddyType} />
                        </div>
                        {member.username && (
                          <p className="text-primary text-sm truncate">@{member.username}</p>
                        )}
                        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {location && (
                            <p className="flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-primary" /> {location}
                            </p>
                          )}
                          {memberSince && (
                            <p className="flex items-center gap-1.5">
                              <CalendarDays className="w-3.5 h-3.5 text-primary" /> Since {memberSince}
                            </p>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
