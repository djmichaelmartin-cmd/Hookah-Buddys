import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import {
  useGetCurrentUser,
  useGetEvent,
  useToggleEventRsvp,
  useToggleEventSave,
  getGetEventQueryKey,
  getListEventsQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Bookmark,
  CalendarDays,
  Check,
  Clock,
  Loader2,
  MapPin,
  Share2,
  Users,
  DollarSign,
  Info
} from "lucide-react";
import { EventHost } from "@/components/EventHost";

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function EventDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "", 10);
  const { data: session } = useGetCurrentUser();
  const loggedIn = !!session?.user;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: event,
    isLoading,
    isError,
  } = useGetEvent(id, {
    query: { queryKey: getGetEventQueryKey(id), enabled: Number.isInteger(id) },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetEventQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
  };
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
            : result.rsvped && event
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

  const shareEvent = async () => {
    const url = window.location.href;
    const title = event?.title ?? "Hookah event";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Share it with your Buddys." });
    } catch {
      toast({
        title: "Couldn't copy the link",
        description: url,
        variant: "destructive",
      });
    }
  };

  const notFound = isError || (!isLoading && !event);
  const isPast = event ? new Date(event.startsAt).getTime() < Date.now() : false;
  const cancelled = event?.status === "cancelled";

  const isMeetup = event?.sourceType === 'meetup_event';
  const isWaitlisted = event?.viewerWaitlistPosition != null;
  const isPaidDisabled = isMeetup && event?.isPaid && !event?.rsvped && !isWaitlisted;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Link
          href="/events"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> All events
        </Link>

        {isLoading ? (
          <div className="py-20 flex flex-col items-center justify-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p>Loading event...</p>
          </div>
        ) : notFound ? (
          <div className="py-20 flex flex-col items-center justify-center text-center bg-card/20 rounded-2xl border border-white/5 backdrop-blur-md">
            <CalendarDays className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-serif text-xl text-white mb-2">Event not found</h3>
            <p className="text-muted-foreground max-w-sm">
              This event may have been removed or cancelled. Check the upcoming
              events for what's next.
            </p>
            <Link
              href="/events"
              className="mt-6 inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-sm bg-primary text-primary-foreground font-medium"
            >
              Browse events
            </Link>
          </div>
        ) : event ? (
          <div className="rounded-2xl bg-card/30 border border-white/5 backdrop-blur-md overflow-hidden">
            {event.imageUrl && (
              <img
                src={event.imageUrl}
                alt=""
                className="w-full h-64 sm:h-80 object-cover"
              />
            )}
            <div className="p-6 sm:p-8">
              {cancelled && (
                <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  This event has been cancelled.
                </div>
              )}

              <div className="flex flex-col gap-3 mb-4">
                <div className="flex items-start gap-2">
                  <h1 className="font-serif text-3xl text-white font-bold leading-snug flex-1 min-w-0">
                    {event.title}
                  </h1>
                  <div className="flex gap-1.5 shrink-0">
                    {isPast && !cancelled && (
                      <span className="px-2.5 py-1 rounded-full text-xs bg-white/5 text-muted-foreground border border-white/10">
                        Past
                      </span>
                    )}
                    {isWaitlisted && (
                      <span className="px-2.5 py-1 rounded-full text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20" data-testid="detail-waitlisted-badge">
                        Waitlisted #{event?.viewerWaitlistPosition}
                      </span>
                    )}
                    {event.isPaid && (
                      <span className="px-2.5 py-1 rounded-full text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-0.5">
                        <DollarSign className="w-3 h-3" /> Paid
                      </span>
                    )}
                  </div>
                </div>

                {isMeetup && (event.meetupName || (event as { businessId?: number | null }).businessId) && (
                  <div>
                    <EventHost
                      event={event}
                      fallbackName={event.meetupName}
                      fallbackHref={event.meetupId ? `/meetups/${event.meetupId}` : undefined}
                    />
                  </div>
                )}
              </div>

              <div className="mt-6 flex flex-col gap-3 p-4 bg-background/30 rounded-xl border border-white/5">
                <p className="text-sm text-white/80 flex items-center gap-3">
                  <CalendarDays className="h-4 w-4 shrink-0 text-primary/70" />
                  {formatEventDate(event.startsAt)}
                </p>
                {event.endsAt && (
                  <p className="text-sm text-white/80 flex items-center gap-3">
                    <Clock className="h-4 w-4 shrink-0 text-primary/70" />
                    Ends {formatEventDate(event.endsAt)}
                  </p>
                )}
                <p className="text-sm text-white/80 flex items-start gap-3">
                  <MapPin className="h-4 w-4 shrink-0 text-primary/70 mt-0.5" />
                  <span>
                    {event.eventFormat === 'online' ? "Online Event" : (
                      <>{event.venueName ? <span className="font-bold block">{event.venueName}</span> : ""}
                      <span className="text-white/70">{event.city}, {event.state}</span></>
                    )}
                  </span>
                </p>
                <div className="flex items-center justify-between mt-2 pt-3 border-t border-white/5">
                  <p className="text-sm text-white/80 flex items-center gap-2">
                    <Users className="h-4 w-4 shrink-0 text-primary/70" />
                    <span><strong className="text-white" data-testid="detail-attendee-count">{event.attendeeCount ?? event.rsvpCount}</strong> going {event.attendeeLimit ? `(Limit ${event.attendeeLimit})` : ''}</span>
                  </p>

                  {event.eventFormat && (
                    <span className="text-xs uppercase tracking-wider text-white/50 font-bold">
                      {event.eventFormat.replace('_', ' ')}
                    </span>
                  )}
                </div>
              </div>

              {event.eventCategory && (
                <div className="mt-4 flex gap-2">
                  <span className="px-2 py-1 bg-white/5 rounded text-xs text-white/60 border border-white/10 uppercase tracking-wider font-medium">{event.eventCategory}</span>
                  {event.topics?.map(t => <span key={t} className="px-2 py-1 bg-white/5 rounded text-xs text-white/60 border border-white/10">{t}</span>)}
                </div>
              )}

              {event.attendees && event.attendees.length > 0 && (
                <div className="mt-6 pt-6 border-t border-white/5" data-testid="attendee-preview">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground/70 mb-3">
                    Who's going
                  </p>
                  <div className="flex items-center">
                    <div className="flex -space-x-2.5">
                      {event.attendees.map((a) =>
                        a.profilePhotoUrl ? (
                          <img
                            key={a.id}
                            src={a.profilePhotoUrl}
                            alt={a.name}
                            title={a.name}
                            className="h-10 w-10 rounded-full object-cover ring-2 ring-background bg-card"
                          />
                        ) : (
                          <div
                            key={a.id}
                            title={a.name}
                            className="h-10 w-10 rounded-full ring-2 ring-background bg-primary/20 text-primary flex items-center justify-center text-xs font-semibold uppercase"
                          >
                            {a.name.slice(0, 1)}
                          </div>
                        ),
                      )}
                    </div>
                    {(event.attendeeCount ?? 0) > event.attendees.length && (
                      <span className="ml-4 text-sm text-muted-foreground">
                        +{(event.attendeeCount ?? 0) - event.attendees.length} more
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground/90 truncate">
                    {event.attendees
                      .slice(0, 3)
                      .map((a) => a.name)
                      .join(", ")}
                    {event.attendees.length > 3 ? " and others are going" : " going"}
                  </p>
                </div>
              )}

              {event.description && (
                <div className="mt-6 pt-6 border-t border-white/5">
                  <h3 className="text-lg font-serif text-white mb-3">About</h3>
                  <p className="text-sm text-muted-foreground/90 whitespace-pre-line leading-relaxed">
                    {event.description}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 mt-8 pt-6 border-t border-white/5">
                {isPaidDisabled ? (
                  <div className="flex items-center gap-2 px-4 py-2 bg-orange-500/10 border border-orange-500/20 rounded-full">
                    <Info className="w-5 h-5 text-orange-400" />
                    <span className="text-sm text-orange-400 font-medium">Checkout not yet available</span>
                  </div>
                ) : (
                  <button
                    onClick={() =>
                      loggedIn ? rsvp.mutate({ id: event.id }) : requireLogin()
                    }
                    disabled={rsvp.isPending || isPast || cancelled}
                    data-testid={isWaitlisted ? "leave-waitlist-btn" : "rsvp-btn"}
                    className={
                      event.rsvped
                        ? `inline-flex items-center gap-1.5 px-6 py-2.5 rounded-full text-sm font-bold disabled:opacity-60 transition-all ${isMeetup ? 'bg-orange-600 text-white hover:bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.3)]' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`
                        : isWaitlisted
                        ? "inline-flex items-center gap-1.5 px-6 py-2.5 rounded-full text-sm font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-all disabled:opacity-60"
                        : "inline-flex items-center gap-1.5 px-6 py-2.5 rounded-full text-sm font-bold bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all disabled:opacity-60"
                    }
                  >
                    {event.rsvped && <Check className="h-4 w-4" />}
                    {event.rsvped ? "Going" : isWaitlisted ? "Leave Waitlist" : "RSVP Now"}
                  </button>
                )}

                <button
                  onClick={() =>
                    loggedIn ? save.mutate({ id: event.id }) : requireLogin()
                  }
                  disabled={save.isPending || isPast || cancelled}
                  aria-label={event.saved ? "Unsave event" : "Save event"}
                  className={
                    event.saved
                      ? "inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium border border-primary/30 bg-primary/10 text-primary disabled:opacity-60"
                      : "inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium text-white/70 hover:text-white bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-60"
                  }
                >
                  <Bookmark
                    className={event.saved ? "h-4 w-4 fill-primary" : "h-4 w-4"}
                  />
                  {event.saved ? "Saved" : "Save"}
                </button>

                <button
                  onClick={shareEvent}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-medium text-white/70 hover:text-white bg-white/5 border border-white/10 hover:bg-white/10 transition-colors ml-auto"
                >
                  <Share2 className="h-4 w-4" /> Share
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
