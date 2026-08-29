import { useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import {
  listEvents,
  useGetCurrentUser,
  useListEvents,
  useToggleEventRsvp,
  useToggleEventSave,
  getListEventsQueryKey,
  type Event,
  type ListEventsParams,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CommunityTopicsNav } from "@/components/lounge/CommunityTopicsNav";
import {
  CalendarDays,
  MapPin,
  Bookmark,
  Check,
  Loader2,
  Users,
  DollarSign,
  Info,
  Filter,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { EventHost } from "@/components/EventHost";

type TabId = "upcoming" | "past" | "going" | "saved";

const PAST_PAGE_SIZE = 20;
const TABS: { id: TabId; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "going", label: "Going" },
  { id: "saved", label: "Saved" },
];

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EventCard({ event, loggedIn }: { event: Event; loggedIn: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
  const requireLogin = () =>
    toast({
      title: "Sign in required",
      description: "Log in to RSVP and save events.",
      variant: "destructive",
    });
  const rsvp = useToggleEventRsvp({
    mutation: {
      onSuccess: (result) => {
        invalidate();
        toast({
          title: result.waitlisted
            ? `You're waitlisted${result.waitlistPosition != null ? ` #${result.waitlistPosition}` : ""}`
            : result.rsvped
              ? "You're going!"
              : "RSVP removed",
          description: result.waitlisted
            ? "We'll let you know if a spot opens up."
            : result.rsvped
              ? `See you at ${event.title}.`
              : undefined,
        });
      },
      onError: () =>
        toast({
          title: "RSVP failed",
          description: "Please try again in a moment.",
          variant: "destructive",
        }),
    },
  });
  const save = useToggleEventSave({
    mutation: {
      onSuccess: (result) => {
        invalidate();
        toast({ title: result.saved ? "Event saved" : "Event removed from saved" });
      },
      onError: () =>
        toast({
          title: "Save failed",
          description: "Please try again in a moment.",
          variant: "destructive",
        }),
    },
  });

  const isPast = new Date(event.startsAt).getTime() < Date.now();
  const isMeetup = event.sourceType === 'meetup_event';
  const isWaitlisted = event.viewerWaitlistPosition != null;
  const isPaidDisabled = isMeetup && event.isPaid && !event.rsvped && !isWaitlisted;

  return (
    <div className={`rounded-2xl bg-card/30 border border-white/5 backdrop-blur-md overflow-hidden flex flex-col sm:flex-row transition-all hover:bg-card/40 ${isMeetup ? 'hover:border-orange-500/30' : 'hover:border-primary/30'}`}>
      {event.imageUrl && (
        <img
          src={event.imageUrl}
          alt=""
          className="h-40 sm:h-auto sm:w-48 object-cover shrink-0"
        />
      )}
      <div className="p-5 flex-1 min-w-0 flex flex-col">
        <div className="flex items-start gap-2 mb-1">
          <h3 className="text-lg text-white font-semibold leading-snug flex-1 min-w-0">
            <Link
              href={`/events/${event.id}`}
              className="hover:text-primary transition-colors"
            >
              {event.title}
            </Link>
          </h3>
          <div className="flex items-center gap-1.5 shrink-0">
            {isPast && (
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-white/5 text-muted-foreground border border-white/10">
                Past
              </span>
            )}
            {isWaitlisted && (
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-500/10 text-amber-400 border border-amber-500/20" data-testid="waitlisted-badge">
                Waitlisted #{event.viewerWaitlistPosition}
              </span>
            )}
            {event.isPaid && (
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-0.5">
                <DollarSign className="w-3 h-3" /> Paid
              </span>
            )}
          </div>
        </div>

        {isMeetup && (event.meetupName || (event as { businessId?: number | null }).businessId) && (
          <div className="mb-2">
            <EventHost
              event={event}
              fallbackName={event.meetupName}
              fallbackHref={event.meetupId ? `/meetups/${event.meetupId}` : undefined}
              compact
            />
          </div>
        )}

        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4 shrink-0 text-primary/70" />
          {formatEventDate(event.startsAt)}
        </p>
        <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
          <MapPin className="h-4 w-4 shrink-0 text-primary/70" />
          {event.eventFormat === 'online' ? "Online Event" : (
            <>{event.venueName ? `${event.venueName} · ` : ""}{event.city}, {event.state}</>
          )}
        </p>

        {event.description && (
          <p className="text-sm text-muted-foreground/80 mt-2 line-clamp-2">
            {event.description}
          </p>
        )}

        <div className="mt-auto pt-4 flex flex-wrap items-center gap-3">
          {isPaidDisabled ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded-full">
              <Info className="w-4 h-4 text-orange-400" />
              <span className="text-xs text-orange-400 font-medium">Checkout not yet available</span>
            </div>
          ) : (
            <button
              onClick={() => (loggedIn ? rsvp.mutate({ id: event.id }) : requireLogin())}
              disabled={rsvp.isPending || isPast}
              data-testid={isWaitlisted ? "leave-waitlist-btn" : "rsvp-btn"}
              className={
                event.rsvped
                  ? `inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium disabled:opacity-60 ${isMeetup ? 'bg-orange-600 text-white' : 'bg-primary text-primary-foreground'}`
                  : isWaitlisted
                  ? "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium disabled:opacity-60 bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                  : "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60"
              }
            >
              {event.rsvped && <Check className="h-3.5 w-3.5" />}
              {event.rsvped ? "Going" : isWaitlisted ? "Leave Waitlist" : "RSVP"}
            </button>
          )}

          <button
            onClick={() => (loggedIn ? save.mutate({ id: event.id }) : requireLogin())}
            disabled={save.isPending || isPast}
            aria-label={event.saved ? "Unsave event" : "Save event"}
            className={
              event.saved
                ? "inline-flex items-center px-2.5 py-1.5 rounded-full text-sm text-primary disabled:opacity-60"
                : "inline-flex items-center px-2.5 py-1.5 rounded-full text-sm text-muted-foreground hover:text-white transition-colors disabled:opacity-60"
            }
          >
            <Bookmark className={event.saved ? "h-4 w-4 fill-primary" : "h-4 w-4"} />
          </button>

          <div className="text-xs text-muted-foreground ml-auto flex items-center gap-3">
            {event.eventFormat && (
              <span className="capitalize hidden sm:inline">{event.eventFormat.replace('_', ' ')}</span>
            )}
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              <span data-testid="event-card-attendee-count">{event.attendeeCount ?? event.rsvpCount}</span> {event.attendeeLimit ? `/ ${event.attendeeLimit}` : ""} going
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Events() {
  const { data: session } = useGetCurrentUser();
  const loggedIn = !!session?.user;
  const [tab, setTab] = useState<TabId>("upcoming");
  const tabRef = useRef<TabId>("upcoming");
  const [extra, setExtra] = useState<Event[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const { toast } = useToast();

  const [showFilters, setShowFilters] = useState(false);
  const [city, setCity] = useState("");
  const debouncedCity = useDebounce(city, 500);
  const [state, setState] = useState("");
  const [eventFormat, setEventFormat] = useState<string>("all");
  const [sourceType, setSourceType] = useState<string>("all");
  const [priceType, setPriceType] = useState<string>("all");
  const [topic, setTopic] = useState("");
  const debouncedTopic = useDebounce(topic, 500);

  const pageSize = tab === "past" ? PAST_PAGE_SIZE : 50;

  const params: ListEventsParams = {
    limit: pageSize,
    scope: tab === "past" ? "past" : undefined,
    filter: tab === "going" ? "going" : tab === "saved" ? "saved" : undefined,
    city: debouncedCity || undefined,
    state: state || undefined,
    eventFormat: eventFormat !== "all" ? (eventFormat as any) : undefined,
    sourceType: sourceType !== "all" ? (sourceType as any) : undefined,
    priceType: priceType !== "all" ? (priceType as any) : undefined,
    topic: debouncedTopic || undefined,
  };

  const isPublicTab = tab === "upcoming" || tab === "past";
  const { data: firstPage, isLoading } = useListEvents(params, {
    query: { queryKey: getListEventsQueryKey(params), enabled: isPublicTab || loggedIn },
  });

  const events = firstPage ? [...firstPage, ...extra] : firstPage;
  const showLoadMore = !exhausted && (firstPage?.length ?? 0) === pageSize;

  const selectTab = (t: TabId) => {
    tabRef.current = t;
    setTab(t);
    setExtra([]);
    setExhausted(false);
    setLoadingMore(false);
  };

  const loadMore = async () => {
    if (loadingMore || !firstPage) return;
    const requestTab = tab;
    setLoadingMore(true);
    try {
      const offset = firstPage.length + extra.length;
      const more = await listEvents({ ...params, offset });
      if (tabRef.current !== requestTab) return;
      const seen = new Set([...firstPage, ...extra].map((e) => e.id));
      setExtra((prev) => [...prev, ...more.filter((e) => !seen.has(e.id))]);
      if (more.length < pageSize) setExhausted(true);
    } catch {
      if (tabRef.current !== requestTab) return;
      toast({
        title: "Couldn't load more events",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      if (tabRef.current === requestTab) setLoadingMore(false);
    }
  };

  const emptyCopy: Record<TabId, { title: string; body: string }> = {
    upcoming: {
      title: "No upcoming events found.",
      body: "Check back soon — new hookah nights and lounge events are added all the time, or try adjusting your filters.",
    },
    past: {
      title: "No past events yet.",
      body: "Once events wrap up, they'll show up here so you can see what the community's been up to.",
    },
    going: {
      title: "You haven't RSVP'd to anything yet.",
      body: "Browse the upcoming events and tap RSVP to see them here.",
    },
    saved: {
      title: "No saved events.",
      body: "Tap the bookmark on any event to keep it handy here.",
    },
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="font-serif text-4xl text-white font-bold flex items-center gap-3 drop-shadow-md">
            Hookah Events <CalendarDays className="h-6 w-6 text-primary" />
          </h1>
          <p className="text-muted-foreground mt-2">
            Everything coming up in the HookahBuddys community — RSVP, save, and show up.
          </p>
        </div>

        <CommunityTopicsNav />

        <div className="flex items-center justify-between gap-2 mb-6">
          <div className="flex gap-2 overflow-x-auto hide-scrollbar">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => selectTab(t.id)}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                  tab === t.id
                    ? "bg-white text-background shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                    : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white border border-white/5"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={`shrink-0 rounded-full h-9 border-white/10 ${showFilters ? 'bg-primary/20 text-primary border-primary/30' : 'bg-background text-muted-foreground hover:text-white'}`}
          >
            <Filter className="w-4 h-4 mr-2" /> Filters
          </Button>
        </div>

        {showFilters && (
          <div className="mb-6 p-4 bg-card/40 border border-white/10 rounded-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 flex gap-3">
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City"
                  className="w-full bg-background/50 border-white/10"
                />
                <Input
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  placeholder="State (e.g. FL)"
                  maxLength={2}
                  className="w-24 bg-background/50 border-white/10"
                />
              </div>
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Topic / Category"
                  className="w-full pl-9 bg-background/50 border-white/10"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger className="bg-background/50 border-white/10">
                  <SelectValue placeholder="Event Host" />
                </SelectTrigger>
                <SelectContent className="bg-card border-white/10">
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="native">Native Events Only</SelectItem>
                  <SelectItem value="meetup">Meetups Only</SelectItem>
                </SelectContent>
              </Select>

              <Select value={eventFormat} onValueChange={setEventFormat}>
                <SelectTrigger className="bg-background/50 border-white/10">
                  <SelectValue placeholder="Format" />
                </SelectTrigger>
                <SelectContent className="bg-card border-white/10">
                  <SelectItem value="all">All Formats</SelectItem>
                  <SelectItem value="in_person">In Person</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>

              <Select value={priceType} onValueChange={setPriceType}>
                <SelectTrigger className="bg-background/50 border-white/10">
                  <SelectValue placeholder="Price" />
                </SelectTrigger>
                <SelectContent className="bg-card border-white/10">
                  <SelectItem value="all">Any Price</SelectItem>
                  <SelectItem value="free">Free / BYOB</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {!isPublicTab && !loggedIn ? (
          <div className="py-20 flex flex-col items-center justify-center text-center bg-card/20 rounded-2xl border border-white/5 backdrop-blur-md">
            <h3 className="font-serif text-xl text-white mb-2">Sign in to see your events</h3>
            <p className="text-muted-foreground max-w-sm">
              Log in to view the events you're going to and the ones you've saved.
            </p>
          </div>
        ) : isLoading ? (
          <div className="py-20 flex flex-col items-center justify-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p>Loading events...</p>
          </div>
        ) : (events?.length ?? 0) === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center bg-card/20 rounded-2xl border border-white/5 backdrop-blur-md">
            <CalendarDays className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-serif text-xl text-white mb-2">{emptyCopy[tab].title}</h3>
            <p className="text-muted-foreground max-w-sm">{emptyCopy[tab].body}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {events!.map((event) => (
              <EventCard key={event.id} event={event} loggedIn={loggedIn} />
            ))}
            {showLoadMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-2 self-center px-6 py-2 rounded-full text-sm font-medium bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white border border-white/5 transition-all disabled:opacity-60 flex items-center gap-2"
              >
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
