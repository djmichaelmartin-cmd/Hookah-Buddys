import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDolls,
  useListLounges,
  useGetCurrentUser,
  useListEvents,
  useToggleEventRsvp,
  useToggleEventSave,
  getListEventsQueryKey,
  useListTrendingHashtags,
  type Event,
  useListOnlineUsers,
  getListOnlineUsersQueryKey,
  type OnlineUser,
} from "@workspace/api-client-react";
import { BadgeCheck, MapPin, Star, Crown, CalendarDays, Bookmark, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Props = {
  onSelectCategory?: (category: string) => void;
  onSelectHashtag?: (tag: string) => void;
  activeHashtag?: string;
};
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card/30 border border-white/5 backdrop-blur-md p-4">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      {children}
    </div>
  );
}

function DollRow({ doll, online }: { doll: any; online?: boolean }) {
  return (
    <Link
      href={`/dolls/${doll.id}`}
      className="flex items-center gap-3 py-1.5 group"
    >
      <div className="relative shrink-0">
        {doll.profilePhotoUrl ? (
          <img
            src={doll.profilePhotoUrl}
            alt=""
            className="h-9 w-9 rounded-full object-cover border border-white/10"
          />
        ) : (
          <div className="h-9 w-9 rounded-full bg-primary/10 border border-primary/20" />
        )}
        {online && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-white truncate group-hover:text-primary transition-colors flex items-center gap-1">
          {doll.stageName}
          {doll.verified && <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" />}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {doll.city}, {doll.state}
        </p>
      </div>
    </Link>
  );
}

function OnlineUserRow({ user }: { user: OnlineUser }) {
  const href = user.role === "doll" && user.dollId ? `/dolls/${user.dollId}` : `/bros/${user.id}`;
  return (
    <Link href={href} className="flex items-center gap-3 py-1.5 group">
      <div className="relative shrink-0">
        {user.profilePhotoUrl ? (
          <img
            src={user.profilePhotoUrl}
            alt=""
            className="h-9 w-9 rounded-full object-cover border border-white/10"
          />
        ) : (
          <div className="h-9 w-9 rounded-full bg-primary/10 border border-primary/20" />
        )}
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-white truncate group-hover:text-primary transition-colors flex items-center gap-1">
          {user.displayName}
          {user.verified && <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" />}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {user.city && user.state ? `${user.city}, ${user.state}` : user.role === "doll" ? "Doll" : "Bro"}
        </p>
      </div>
    </Link>
  );
}
function formatEventDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EventRow({ event, loggedIn }: { event: Event; loggedIn: boolean }) {
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

  return (
    <div className="py-2 border-b border-white/5 last:border-b-0">
      <p className="text-sm text-white font-medium leading-snug">{event.title}</p>
      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
        <CalendarDays className="h-3 w-3 shrink-0" />
        {formatEventDate(event.startsAt)}
      </p>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <MapPin className="h-3 w-3 shrink-0" />
        {event.loungeId != null && event.venueName ? (
          <Link
            href={`/lounges?q=${encodeURIComponent(event.venueName)}`}
            className="text-primary hover:underline truncate"
          >
            {event.venueName}
          </Link>
        ) : event.venueName ? (
          <span className="truncate">{event.venueName}</span>
        ) : null}
        {event.venueName ? <span>·</span> : null}
        <span className="shrink-0">
          {event.city}, {event.state}
        </span>
      </p>
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={() => (loggedIn ? rsvp.mutate({ id: event.id }) : requireLogin())}
          disabled={rsvp.isPending}
          className={
            event.rsvped
              ? "inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-primary text-primary-foreground font-medium disabled:opacity-60"
              : "inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60"
          }
        >
          {event.rsvped && <Check className="h-3 w-3" />}
          {event.rsvped ? "Going" : "RSVP"}
        </button>
        <button
          onClick={() => (loggedIn ? save.mutate({ id: event.id }) : requireLogin())}
          disabled={save.isPending}
          aria-label={event.saved ? "Unsave event" : "Save event"}
          className={
            event.saved
              ? "inline-flex items-center px-2 py-1 rounded-full text-xs text-primary disabled:opacity-60"
              : "inline-flex items-center px-2 py-1 rounded-full text-xs text-muted-foreground hover:text-white transition-colors disabled:opacity-60"
          }
        >
          <Bookmark className={event.saved ? "h-3.5 w-3.5 fill-primary" : "h-3.5 w-3.5"} />
        </button>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {event.rsvpCount} going
        </span>
      </div>
    </div>
  );
}

export default function LoungeRightSidebar({ onSelectCategory: _onSelectCategory, onSelectHashtag, activeHashtag }: Props) {
  const { data: session } = useGetCurrentUser();
  const { data: onlineUsers } = useListOnlineUsers({
    query: {
      queryKey: getListOnlineUsersQueryKey(),
      refetchInterval: 60_000,
      enabled: !!session?.user,
    },
  });
  const { data: featuredDolls } = useListDolls({ featured: true });
  const { data: lounges } = useListLounges({ limit: 3 });
  const { data: events } = useListEvents({ limit: 4 });
  const { data: trendingHashtags } = useListTrendingHashtags({ limit: 6 });

  const onlineList = (onlineUsers ?? []).slice(0, 5);
  const onlineDollIds = new Set(
    onlineList.filter((u) => u.role === "doll" && u.dollId).map((u) => u.dollId as number),
  );
  const suggested = (featuredDolls ?? [])
    .filter((d) => !onlineDollIds.has(d.id))
    .slice(0, 4);

  return (
    <aside className="space-y-4">
      {onlineList.length > 0 && (
        <SectionCard title="Online Now">
          {onlineList.map((user) => (
            <OnlineUserRow key={user.id} user={user} />
          ))}
        </SectionCard>
      )}

      {suggested.length > 0 && (
        <SectionCard title="Suggested Dolls">
          {suggested.map((doll) => (
            <DollRow key={doll.id} doll={doll} />
          ))}
          <Link
            href="/browse"
            className="block text-xs text-primary hover:underline mt-2"
          >
            Browse all Dolls →
          </Link>
        </SectionCard>
      )}

      {(events?.length ?? 0) > 0 && (
        <SectionCard title="Upcoming Events">
          {events!.map((event) => (
            <EventRow key={event.id} event={event} loggedIn={!!session?.user} />
          ))}
          <Link
            href="/events"
            className="block text-xs text-primary hover:underline mt-2"
          >
            See all events →
          </Link>
        </SectionCard>
      )}

      {(trendingHashtags?.length ?? 0) > 0 && (
        <SectionCard title="Trending in The Lounge">
          <div className="flex flex-wrap gap-2">
            {trendingHashtags!.map((t) => (
              <button
                key={t.tag}
                onClick={() => onSelectHashtag?.(t.tag)}
                title={`${t.postCount} post${t.postCount === 1 ? "" : "s"}`}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  activeHashtag === t.tag
                    ? "bg-primary/20 text-primary border-primary/30"
                    : "bg-white/5 text-muted-foreground border-white/5 hover:bg-white/10 hover:text-white"
                }`}
              >
                #{t.displayTag}
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {(lounges?.length ?? 0) > 0 && (
        <SectionCard title="Lounge Spotlight">
          {lounges!.slice(0, 3).map((lounge) => (
            <div key={lounge.id} className="py-1.5">
              <p className="text-sm text-white flex items-center gap-1.5">
                {lounge.name}
                {typeof lounge.rating === "number" && lounge.rating > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-primary">
                    <Star className="h-3 w-3 fill-primary" />
                    {lounge.rating.toFixed(1)}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {lounge.city}, {lounge.state}
              </p>
            </div>
          ))}
        </SectionCard>
      )}

      {/* Sponsored / upgrade promo */}
      {session?.user?.role !== "doll" && (
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card/40 to-card/20 backdrop-blur-md p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1">
            Sponsored
          </p>
          <h3 className="text-sm font-semibold text-white flex items-center gap-1.5 mb-1">
            <Crown className="h-4 w-4 text-primary" /> Go Gold
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Unlock premium Doll content, messaging credits, and VIP perks.
          </p>
          <Link
            href="/pricing"
            className="inline-block w-full text-center rounded-full bg-primary text-primary-foreground text-xs font-medium py-2 hover:opacity-90 transition-opacity"
          >
            Upgrade Now
          </Link>
        </div>
      )}
    </aside>
  );
}
