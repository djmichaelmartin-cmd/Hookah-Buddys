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
} from "lucide-react";

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
          title: result.rsvped ? "You're going!" : "RSVP removed",
          description: result.rsvped ? `See you at ${event.title}.` : undefined,
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

  return (
    <div className="rounded-2xl bg-card/30 border border-white/5 backdrop-blur-md overflow-hidden flex flex-col sm:flex-row">
      {event.imageUrl && (
        <img
          src={event.imageUrl}
          alt=""
          className="h-40 sm:h-auto sm:w-48 object-cover shrink-0"
        />
      )}
      <div className="p-5 flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <h3 className="text-lg text-white font-semibold leading-snug flex-1 min-w-0">
            <Link
              href={`/events/${event.id}`}
              className="hover:text-primary transition-colors"
            >
              {event.title}
            </Link>
          </h3>
          {isPast && (
            <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] bg-white/5 text-muted-foreground border border-white/10">
              Past
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1.5 flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4 shrink-0 text-primary/70" />
          {formatEventDate(event.startsAt)}
        </p>
        <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
          <MapPin className="h-4 w-4 shrink-0 text-primary/70" />
          {event.venueName ? `${event.venueName} · ` : ""}
          {event.city}, {event.state}
        </p>
        {event.description && (
          <p className="text-sm text-muted-foreground/80 mt-2 line-clamp-2">
            {event.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => (loggedIn ? rsvp.mutate({ id: event.id }) : requireLogin())}
            disabled={rsvp.isPending || isPast}
            className={
              event.rsvped
                ? "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm bg-primary text-primary-foreground font-medium disabled:opacity-60"
                : "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60"
            }
          >
            {event.rsvped && <Check className="h-3.5 w-3.5" />}
            {event.rsvped ? "Going" : "RSVP"}
          </button>
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
          <span className="text-xs text-muted-foreground ml-auto inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {event.rsvpCount} going
          </span>
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

  const pageSize = tab === "past" ? PAST_PAGE_SIZE : 50;
  const params: ListEventsParams =
    tab === "upcoming"
      ? { limit: pageSize }
      : tab === "past"
        ? { limit: pageSize, scope: "past" }
        : { limit: pageSize, filter: tab === "going" ? "going" : "saved" };
  const isPublicTab = tab === "upcoming" || tab === "past";
  const { data: firstPage, isLoading } = useListEvents(params, {
    query: { queryKey: getListEventsQueryKey(params), enabled: isPublicTab || loggedIn },
  });

  const events = firstPage ? [...firstPage, ...extra] : firstPage;
  const showLoadMore =
    !exhausted && (firstPage?.length ?? 0) === pageSize;

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
      if (tabRef.current !== requestTab) return; // stale response after tab switch
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
      title: "No upcoming events yet.",
      body: "Check back soon — new hookah nights and lounge events are added all the time.",
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

        <div className="flex gap-2 mb-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                tab === t.id
                  ? "bg-white text-background shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white border border-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

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
