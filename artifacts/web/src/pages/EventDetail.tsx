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
} from "lucide-react";

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
          title: result.rsvped ? "You're going!" : "RSVP removed",
          description:
            result.rsvped && event ? `See you at ${event.title}.` : undefined,
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
      return; // user cancelled the share sheet
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Share it with your friends." });
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
              <div className="flex items-start gap-2">
                <h1 className="font-serif text-3xl text-white font-bold leading-snug flex-1 min-w-0">
                  {event.title}
                </h1>
                {isPast && (
                  <span className="shrink-0 px-2.5 py-1 rounded-full text-xs bg-white/5 text-muted-foreground border border-white/10">
                    Past
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 shrink-0 text-primary/70" />
                  {formatEventDate(event.startsAt)}
                </p>
                {event.endsAt && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Clock className="h-4 w-4 shrink-0 text-primary/70" />
                    Ends {formatEventDate(event.endsAt)}
                  </p>
                )}
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0 text-primary/70" />
                  {event.venueName ? `${event.venueName} · ` : ""}
                  {event.city}, {event.state}
                </p>
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Users className="h-4 w-4 shrink-0 text-primary/70" />
                  {event.rsvpCount} going
                </p>
              </div>

              {event.description && (
                <p className="text-sm text-muted-foreground/90 mt-6 whitespace-pre-line leading-relaxed">
                  {event.description}
                </p>
              )}

              <div className="flex items-center gap-2 mt-8">
                <button
                  onClick={() =>
                    loggedIn ? rsvp.mutate({ id: event.id }) : requireLogin()
                  }
                  disabled={rsvp.isPending || isPast}
                  className={
                    event.rsvped
                      ? "inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-sm bg-primary text-primary-foreground font-medium disabled:opacity-60"
                      : "inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-sm bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60"
                  }
                >
                  {event.rsvped && <Check className="h-3.5 w-3.5" />}
                  {event.rsvped ? "Going" : "RSVP"}
                </button>
                <button
                  onClick={() =>
                    loggedIn ? save.mutate({ id: event.id }) : requireLogin()
                  }
                  disabled={save.isPending || isPast}
                  aria-label={event.saved ? "Unsave event" : "Save event"}
                  className={
                    event.saved
                      ? "inline-flex items-center px-3 py-2 rounded-full text-sm text-primary disabled:opacity-60"
                      : "inline-flex items-center px-3 py-2 rounded-full text-sm text-muted-foreground hover:text-white transition-colors disabled:opacity-60"
                  }
                >
                  <Bookmark
                    className={event.saved ? "h-4 w-4 fill-primary" : "h-4 w-4"}
                  />
                </button>
                <button
                  onClick={shareEvent}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm text-muted-foreground hover:text-white transition-colors ml-auto"
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
