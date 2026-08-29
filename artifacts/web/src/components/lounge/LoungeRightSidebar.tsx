import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDolls,
  useGetLocalLoungeSpotlight,
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
  useListPlans,
  useListSubscriptions,
  getListSubscriptionsQueryKey,
  useListGroups,
  useListReels,
  getListReelsQueryKey,
} from "@workspace/api-client-react";
import { BadgeCheck, MapPin, Star, Crown, CalendarDays, Bookmark, Check, Users, Lock, AlertCircle, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Props = {
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
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#31C48D] border-2 border-background" />
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
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#31C48D] border-2 border-background" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-white truncate group-hover:text-primary transition-colors flex items-center gap-1">
          {user.displayName}
          {user.verified && <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" />}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {user.city && user.state ? `${user.city}, ${user.state}` : user.role === "doll" ? "Buddy" : "Bro"}
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

export default function LoungeRightSidebar({ onSelectHashtag, activeHashtag }: Props) {
  const { data: session } = useGetCurrentUser();
  const { data: onlineUsers } = useListOnlineUsers({
    query: {
      queryKey: getListOnlineUsersQueryKey(),
      refetchInterval: 60_000,
      enabled: !!session?.user,
    },
  });
  const isMember = !!session?.authenticated && session.user?.role === "member";
  const { data: memberPlans } = useListPlans({ audience: "member" });
  const { data: subscriptions } = useListSubscriptions({
    query: { queryKey: getListSubscriptionsQueryKey(), enabled: isMember },
  });

  // Work out the next membership level the viewer can upgrade to.
  const TIER_ORDER = ["bronze", "silver", "gold", "platinum"];
  const activeMembership = (subscriptions ?? []).find(
    (s) => s.audience === "member" && s.status === "active",
  );
  const currentPlan = (memberPlans ?? []).find((p) => p.id === activeMembership?.planId);
  const currentTierIdx = currentPlan ? TIER_ORDER.indexOf(currentPlan.tier) : 0;
  const upgradePlan = (memberPlans ?? [])
    .filter((p) => TIER_ORDER.indexOf(p.tier) > currentTierIdx)
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))[0];

  const { data: featuredDolls } = useListDolls({ featured: true });
  const { data: spotlight, isLoading: isSpotlightLoading, isError: isSpotlightError } = useGetLocalLoungeSpotlight();
  const { data: events } = useListEvents({ limit: 4 });
  const { data: trendingHashtags } = useListTrendingHashtags({ limit: 6 });
  const { data: featuredGroups } = useListGroups({ featured: true, limit: 3 });
  const { data: recentSparks } = useListReels(
    { visibility: 'public', limit: 3 },
    { query: { queryKey: getListReelsQueryKey({ visibility: 'public', limit: 3 }) } }
  );

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
        <SectionCard title="Suggested Buddys">
          {suggested.map((doll) => (
            <DollRow key={doll.id} doll={doll} />
          ))}
          <Link
            href="/browse"
            className="block text-xs text-primary hover:underline mt-2"
          >
            Browse all Buddys →
          </Link>
        </SectionCard>
      )}

      {(featuredGroups?.groups?.length ?? 0) > 0 && (
        <SectionCard title="Featured Groups">
          {featuredGroups!.groups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.id}`}
              className="flex items-center gap-3 py-1.5 group"
            >
              <div className="relative shrink-0">
                {group.iconUrl ? (
                  <img
                    src={group.iconUrl}
                    alt=""
                    className="h-9 w-9 rounded-lg object-cover border border-white/10"
                  />
                ) : (
                  <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-white truncate group-hover:text-primary transition-colors flex items-center gap-1">
                  {group.name}
                  {group.privacy === 'private' && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {group.memberCount} members
                </p>
              </div>
            </Link>
          ))}
          <Link
            href="/groups"
            className="block text-xs text-primary hover:underline mt-2"
          >
            Explore all Groups →
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

      {recentSparks && recentSparks.length > 0 && (
        <SectionCard title="Recent Sparks">
          <div className="grid grid-cols-3 gap-2 mb-3">
            {recentSparks.map(spark => (
              <Link key={spark.id} href={`/sparks/${spark.id}`} className="group relative aspect-[9/16] rounded-xl overflow-hidden block">
                {spark.thumbnailUrl ? (
                  <img src={spark.thumbnailUrl} alt={spark.caption || "Spark"} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                ) : (
                  <div className="w-full h-full bg-primary/10" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col justify-end p-2 opacity-80 group-hover:opacity-100 transition-opacity">
                  <p className="text-[10px] text-white font-bold truncate leading-tight shadow-black drop-shadow-sm">{spark.userName}</p>
                </div>
              </Link>
            ))}
          </div>
          <Link href="/sparks" className="block text-xs text-primary hover:underline flex items-center gap-1">
            Browse all Sparks <Zap className="w-3 h-3 fill-primary" />
          </Link>
        </SectionCard>
      )}

      <Link
        href="/lounges?spotlight=local"
        aria-label="View today’s local Lounge Spotlight businesses"
        data-testid="link-lounge-spotlight"
        className="block rounded-2xl bg-card/30 border border-white/5 backdrop-blur-md p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group/spotlight"
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Lounge Spotlight</h3>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Top-rated spots near you</p>
          </div>
          <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full font-medium shrink-0">Updated daily</span>
        </div>

        {isSpotlightLoading ? (
          <div className="space-y-3 py-2" data-testid="sidebar-spotlight-loading">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-10 h-10 rounded bg-white/10 shrink-0"></div>
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3 w-3/4 bg-white/10 rounded"></div>
                  <div className="h-2 w-1/2 bg-white/10 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        ) : isSpotlightError ? (
          <div className="py-4 text-center" data-testid="sidebar-spotlight-error">
            <AlertCircle className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Unable to load local spotlights.</p>
            <p className="text-xs text-primary mt-1 group-hover/spotlight:underline">Try browsing all lounges →</p>
          </div>
        ) : spotlight?.state === "login_required" || spotlight?.state === "location_required" || spotlight?.state === "empty" ? (
          <div className="py-4 text-center" data-testid={`sidebar-spotlight-${spotlight.state}`}>
            <MapPin className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground mb-1">{spotlight.message}</p>
            <p className="text-xs text-primary font-medium mt-2 group-hover/spotlight:underline">
              {spotlight.state === "empty" ? "Browse All Lounges →" : "Update to view →"}
            </p>
          </div>
        ) : spotlight?.businesses ? (
          <>
            <div className="space-y-3" data-testid="sidebar-spotlight-cards">
              {spotlight.businesses.slice(0, 3).map((lounge) => (
                <div key={lounge.id} className="flex gap-3 group/card">
                  <div className="w-10 h-10 rounded overflow-hidden bg-white/5 border border-white/10 shrink-0">
                    {lounge.logoUrl || lounge.coverUrl ? (
                      <img src={lounge.logoUrl || lounge.coverUrl || ''} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-primary/20 flex items-center justify-center text-xs font-serif text-primary">
                        {lounge.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 py-0.5">
                    <p className="text-sm text-white flex items-center gap-1.5 leading-none mb-1 group-hover/card:text-primary transition-colors">
                      <span className="truncate">{lounge.name}</span>
                      {lounge.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" />}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {typeof lounge.averageRating === "number" && lounge.averageRating > 0 && (
                        <span className="shrink-0 flex items-center gap-0.5 text-primary">
                          <Star className="h-3 w-3 fill-primary" />
                          {lounge.averageRating.toFixed(1)} <span className="text-muted-foreground ml-0.5">({lounge.reviewCount})</span>
                        </span>
                      )}
                      <span className="truncate">{lounge.city}, {lounge.state}</span>
                      <span className="shrink-0 ml-auto">{lounge.distanceMiles.toFixed(1)}mi</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {spotlight.state === "partial" && (
              <p className="text-[10px] text-muted-foreground mt-4 text-center italic" data-testid="sidebar-spotlight-partial">
                More local Lounge Spotlights coming soon.
              </p>
            )}

            <div className="mt-4 pt-3 border-t border-white/10 text-center">
              <span className="text-xs text-primary font-medium group-hover/spotlight:underline">
                View Today's Local Spotlights →
              </span>
            </div>
          </>
        ) : null}
      </Link>

      {/* Sponsored / upgrade promo — shows the viewer's next upgradable level */}
      {session?.user?.role !== "doll" && upgradePlan && (
        <div className="rounded-2xl border border-[#D6B56D]/20 bg-gradient-to-br from-[#D6B56D]/10 via-card/40 to-card/20 backdrop-blur-md p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1">
            Sponsored
          </p>
          <h3 className="text-sm font-semibold text-white flex items-center gap-1.5 mb-1">
            <Crown className="h-4 w-4 text-[#D6B56D]" /> {upgradePlan.name}
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            {upgradePlan.description ||
              "Unlock premium Buddy content, messaging credits, and VIP perks."}
          </p>
          <Link
            href={
              isMember
                ? `/checkout?type=membership&plan=${upgradePlan.slug}`
                : "/pricing"
            }
            className="inline-block w-full text-center rounded-full bg-[#D6B56D] text-[#111111] text-xs font-medium py-2 hover:bg-[#C9A456] transition-colors"
          >
            {`Upgrade to ${upgradePlan.name.split("—")[0].trim()}`}
          </Link>
        </div>
      )}
    </aside>
  );
}
