import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { useListMeetups, type GroupSummary, type ListMeetupsParams } from "@workspace/api-client-react";
import { Search, CalendarDays, Globe, Lock, Plus, Users, MapPin, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useDebounce } from "@/hooks/use-debounce";
import LoungeLeftSidebar from "@/components/lounge/LoungeLeftSidebar";
import LoungeRightSidebar from "@/components/lounge/LoungeRightSidebar";
import { getErrorMessage } from "@/lib/error";

export default function MeetupsDiscover() {
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 500);
  const [privacy, setPrivacy] = useState<string>("all");
  const [city, setCity] = useState("");
  const debouncedCity = useDebounce(city, 500);
  const [state, setState] = useState("");
  const [interests, setInterests] = useState("");
  const debouncedInterests = useDebounce(interests, 500);
  const [hasUpcomingEvent, setHasUpcomingEvent] = useState(false);
  const [sort, setSort] = useState<string>("most_members");
  const [radius, setRadius] = useState("any");

  const queryParams: ListMeetupsParams = {
    search: debouncedSearch || undefined,
    city: debouncedCity || undefined,
    state: state || undefined,
    interests: debouncedInterests || undefined,
    privacy: privacy !== "all" ? (privacy as any) : undefined,
    hasUpcomingEvent: hasUpcomingEvent ? true : undefined,
    sort: sort as any,
    radius:
      radius === "any"
        ? undefined
        : (Number(radius) as NonNullable<ListMeetupsParams["radius"]>),
  };

  const { data: groupsData, isLoading, isError, error, refetch } = useListMeetups(queryParams);
  const meetups = groupsData?.groups || [];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-[1400px]">
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-serif text-4xl text-white font-bold flex items-center gap-3 drop-shadow-md">
              <span className="text-orange-500">Hookah</span> Meetups
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl">
              Turn shared interests into real lounge nights. Find local sessions, RSVP, and meet fellow HookahBuddys.
            </p>
          </div>
          <Link href="/meetups/create">
            <Button className="bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-full h-11 px-6 shadow-[0_0_15px_rgba(249,115,22,0.4)]">
              <Plus className="h-5 w-5 mr-2" /> Start a Meetup
            </Button>
          </Link>
        </div>

        <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)_320px] lg:gap-6 lg:items-start">
          <div className="hidden lg:block sticky top-[124px] max-h-[calc(100vh-140px)] overflow-y-auto hide-scrollbar">
            <LoungeLeftSidebar />
          </div>

          <div className="min-w-0">
            <div className="flex flex-col gap-4 mb-6 bg-card/40 border border-orange-500/20 p-4 rounded-2xl backdrop-blur-md">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-500/50" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search meetups..."
                    className="pl-9 h-11 bg-background/50 border-orange-500/20 focus-visible:ring-orange-500 rounded-xl"
                  />
                </div>
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City"
                  className="w-full sm:w-[150px] h-11 bg-background/50 border-orange-500/20 focus-visible:ring-orange-500 rounded-xl"
                />
                <Input
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  placeholder="State (e.g. FL)"
                  maxLength={2}
                  className="w-full sm:w-[100px] h-11 bg-background/50 border-orange-500/20 focus-visible:ring-orange-500 rounded-xl"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 items-start sm:items-center">
                <Input
                  value={interests}
                  onChange={(e) => setInterests(e.target.value)}
                  placeholder="Topic / Interest (e.g. shisha, lounges)"
                  className="w-full sm:w-[250px] h-11 bg-background/50 border-orange-500/20 focus-visible:ring-orange-500 rounded-xl"
                />
                <Select value={privacy} onValueChange={setPrivacy}>
                  <SelectTrigger className="w-[140px] h-11 bg-background/50 border-orange-500/20 rounded-xl focus:ring-orange-500">
                    <SelectValue placeholder="Privacy" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-orange-500/20">
                    <SelectItem value="all">All Privacy</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="private">Private (Invite)</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={radius === "any" ? sort : "distance"}
                  onValueChange={setSort}
                  disabled={radius !== "any"}
                >
                  <SelectTrigger className="w-[150px] h-11 bg-background/50 border-orange-500/20 rounded-xl focus:ring-orange-500">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-orange-500/20">
                    <SelectItem value="distance" disabled={radius === "any"}>
                      Nearest First
                    </SelectItem>
                    <SelectItem value="most_members">Most Members</SelectItem>
                    <SelectItem value="most_active">Most Active</SelectItem>
                    <SelectItem value="newest">Newest</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={radius} onValueChange={setRadius}>
                  <SelectTrigger className="w-[185px] h-11 bg-background/50 border-orange-500/20 rounded-xl focus:ring-orange-500">
                    <SelectValue placeholder="Travel distance" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-orange-500/20">
                    <SelectItem value="any">Any distance (incl. online)</SelectItem>
                    <SelectItem value="5">Within 5 miles</SelectItem>
                    <SelectItem value="10">Within 10 miles</SelectItem>
                    <SelectItem value="25">Within 25 miles</SelectItem>
                    <SelectItem value="50">Within 50 miles</SelectItem>
                    <SelectItem value="100">Within 100 miles</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center space-x-2 bg-background/50 px-3 h-11 rounded-xl border border-orange-500/20">
                  <Switch id="upcoming" checked={hasUpcomingEvent} onCheckedChange={setHasUpcomingEvent} />
                  <Label htmlFor="upcoming" className="text-sm cursor-pointer whitespace-nowrap">Upcoming Events</Label>
                </div>
              </div>
              {radius !== "any" && (
                <p className="text-xs text-white/55">
                  Sorted by approximate travel distance from your saved location. Choose “Any distance” to include online meetups.
                </p>
              )}
            </div>

            {isError ? (
               <div className="py-24 text-center bg-card/30 border border-red-500/20 rounded-3xl backdrop-blur-md">
                 <AlertCircle className="w-16 h-16 mx-auto text-red-500/50 mb-4" />
                 <h3 className="text-xl font-serif text-white mb-2">Failed to load meetups</h3>
                  <p className="text-sm text-white/60 mb-5 max-w-md mx-auto">
                    {getErrorMessage(error)}
                  </p>
                 <Button variant="outline" onClick={() => refetch()} className="rounded-full border-red-500/30 text-red-400 hover:bg-red-500/10">
                   Try Again
                 </Button>
                  {radius !== "any" && (
                    <Button variant="ghost" asChild className="ml-2 rounded-full text-orange-300 hover:text-orange-200">
                      <Link href="/profile/edit">Update Profile City</Link>
                    </Button>
                  )}
               </div>
            ) : isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-44 animate-pulse bg-card/50 border border-orange-500/10 rounded-2xl" />
                ))}
              </div>
            ) : meetups.length === 0 ? (
              <div className="py-24 text-center bg-gradient-to-b from-card/30 to-orange-500/5 border border-orange-500/10 rounded-3xl backdrop-blur-md">
                <CalendarDays className="w-16 h-16 mx-auto text-orange-500/40 mb-4" />
                <h3 className="text-xl font-serif text-white mb-2">No meetups found</h3>
                <p className="text-white/60 mb-6 max-w-md mx-auto">
                  Try adjusting your filters or be the spark and create one.
                </p>
                <Link href="/meetups/create">
                  <Button variant="outline" className="rounded-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300">
                    Start a Meetup
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {meetups.map((meetup) => (
                  <MeetupCard key={meetup.id} meetup={meetup} />
                ))}
              </div>
            )}
          </div>

          <div className="hidden xl:block sticky top-[124px] max-h-[calc(100vh-140px)] overflow-y-auto hide-scrollbar">
            <LoungeRightSidebar />
          </div>
        </div>
      </div>
    </Layout>
  );
}

function MeetupCard({ meetup }: { meetup: GroupSummary }) {
  const loc = meetup.meetupCity && meetup.meetupState ? `${meetup.meetupCity}, ${meetup.meetupState}` : meetup.location;
  return (
    <Link href={`/meetups/${meetup.id}`}>
      <div className="group relative flex flex-col h-full bg-card border border-white/10 hover:border-orange-500/50 rounded-2xl overflow-hidden transition-all duration-300 hover-elevate shadow-md cursor-pointer">
        <div className="h-28 bg-[#171A21] relative overflow-hidden shrink-0">
          {meetup.coverUrl ? (
            <img src={meetup.coverUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-amber-500/20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
            <div className="flex flex-wrap gap-1.5 items-center">
              {meetup.meetupInterests && meetup.meetupInterests.length > 0 ? (
                 meetup.meetupInterests.slice(0,2).map(tag => (
                   <span key={tag} className="px-2 py-1 rounded bg-black/60 backdrop-blur text-[10px] text-orange-400 border border-orange-500/20 font-medium uppercase tracking-wider">
                     {tag}
                   </span>
                 ))
              ) : meetup.tags && meetup.tags[0] && (
                 <span className="px-2 py-1 rounded bg-black/60 backdrop-blur text-[10px] text-orange-400 border border-orange-500/20 font-medium uppercase tracking-wider">
                   {meetup.tags[0]}
                 </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="p-4 pt-4 relative flex-grow flex flex-col">
          <div className="flex-grow">
            <h3 className="text-lg font-bold text-white group-hover:text-orange-400 transition-colors line-clamp-1 mb-1">
              {meetup.name}
            </h3>
            {loc && (
              <p className="text-sm text-white/70 mb-3 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-orange-500/70" />
                {loc}
              </p>
            )}
            {typeof meetup.distanceMiles === "number" && (
              <p className="text-xs text-orange-300/80 mb-3 font-medium">
                About {meetup.distanceMiles.toFixed(1)} miles away
              </p>
            )}
            
            <p className="text-sm text-white/60 line-clamp-2 leading-relaxed">
              {meetup.description || "A Hookah Meetup group."}
            </p>
          </div>

          <div className="flex items-center justify-between text-xs text-white/50 mt-4 pt-3 border-t border-white/5">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-orange-400/80">
                <Users className="w-3.5 h-3.5" />
                <span className="font-medium">{meetup.memberCount} members</span>
              </span>
              {meetup.eventCount !== undefined && meetup.eventCount > 0 && (
                <span className="flex items-center gap-1 text-white/70">
                  <CalendarDays className="w-3.5 h-3.5 text-orange-500/50" />
                  <span>{meetup.eventCount} events</span>
                </span>
              )}
              <span className="flex items-center gap-1">
                {meetup.privacy === 'public' ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                <span className="capitalize">{meetup.privacy}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
