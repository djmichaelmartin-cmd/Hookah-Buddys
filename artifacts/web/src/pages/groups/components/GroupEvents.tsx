import { useState } from "react";
import {
  useListGroupEvents,
  useRsvpGroupEvent,
  useCreateGroupEvent,
  useUpdateGroupEvent,
  useDeleteGroupEvent,
  useListGroupEventAttendees,
  useManageGroupEventAttendee,
  useGetGroupEventBroadcastAudience,
  useBroadcastGroupEvent,
  getListGroupEventsQueryKey,
  getListGroupEventAttendeesQueryKey,
  getGetGroupEventBroadcastAudienceQueryKey,
  type GroupEvent,
  type GroupEventBroadcastResult,
  ApiError,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, MapPin, Plus, Trash2, Edit2, Users, Users2, Link as LinkIcon, DollarSign, Clock, Search, MoreHorizontal, Check, X, ShieldAlert, Video, Megaphone, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Link } from "wouter";

export function GroupEvents({
  groupId,
  isAdmin,
  isMeetup = false,
  canMessageAttendees = isAdmin,
}: {
  groupId: number;
  isAdmin: boolean;
  isMeetup?: boolean;
  canMessageAttendees?: boolean;
}) {
  const { data: events, isLoading } = useListGroupEvents(groupId, { limit: 20 });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [locationStr, setLocationStr] = useState("");
  const [startsAt, setStartsAt] = useState("");

  const createEvent = useCreateGroupEvent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Event created" });
        queryClient.invalidateQueries({ queryKey: getListGroupEventsQueryKey(groupId, { limit: 20 }) });
        setIsAdding(false);
      },
      onError: () => toast({ title: "Failed to create event", variant: "destructive" })
    }
  });

  const updateEvent = useUpdateGroupEvent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Event updated" });
        queryClient.invalidateQueries({ queryKey: getListGroupEventsQueryKey(groupId, { limit: 20 }) });
        setEditingId(null);
      },
      onError: () => toast({ title: "Failed to update event", variant: "destructive" })
    }
  });

  const deleteEvent = useDeleteGroupEvent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Event deleted" });
        queryClient.invalidateQueries({ queryKey: getListGroupEventsQueryKey(groupId, { limit: 20 }) });
      },
      onError: () => toast({ title: "Failed to delete event", variant: "destructive" })
    }
  });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setLocationStr("");
    setStartsAt("");
  };

  const handleSave = () => {
    if (!title || !startsAt) {
      toast({ title: "Title and Start Date required", variant: "destructive" });
      return;
    }
    const data = { title, description, location: locationStr, startsAt: new Date(startsAt).toISOString() };
    if (editingId) {
      updateEvent.mutate({ groupId, eventId: editingId, data });
    } else {
      createEvent.mutate({ groupId, data });
    }
  };

  if (isLoading) return <div className="p-6 bg-card border border-white/10 rounded-2xl animate-pulse h-32" />;

  return (
    <div className="bg-card border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-serif text-white">Events</h3>
        {isAdmin && !isAdding && !editingId && (
          isMeetup ? (
            <Link href={`/meetups/${groupId}/create-event`}>
              <Button size="sm" className="bg-orange-600 hover:bg-orange-500 text-white" data-testid="add-event-btn">
                <Plus className="w-4 h-4 mr-2" /> {events && events.length > 0 ? "Add Future Event" : "Complete Meetup"}
              </Button>
            </Link>
          ) : (
            <Button size="sm" onClick={() => setIsAdding(true)} data-testid="add-event-btn">
              <Plus className="w-4 h-4 mr-2" /> Add Event
            </Button>
          )
        )}
      </div>

      {(isAdding || editingId) && (
        <div className="bg-background/50 border border-white/5 p-4 rounded-xl mb-6 space-y-4">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event Title" className="bg-card border-white/10" />
          <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" className="bg-card border-white/10" />
          <div className="grid grid-cols-2 gap-4">
            <Input value={locationStr} onChange={e => setLocationStr(e.target.value)} placeholder="Location" className="bg-card border-white/10" />
            <Input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className="bg-card border-white/10" />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={createEvent.isPending || updateEvent.isPending} data-testid="save-event-btn">Save Event</Button>
            <Button variant="ghost" onClick={() => { setIsAdding(false); setEditingId(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {!events || events.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground border border-dashed border-white/10 rounded-2xl">
          <CalendarDays className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <p>No upcoming events.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map(event => (
            <EventCard
              key={event.id}
              event={event}
              groupId={groupId}
              isAdmin={isAdmin}
              isMeetup={isMeetup}
              canMessageAttendees={canMessageAttendees}
              onDelete={() => deleteEvent.mutate({ groupId, eventId: event.id })}
              onEdit={() => {
                setEditingId(event.id);
                setTitle(event.title);
                setDescription(event.description || "");
                setLocationStr(event.location || "");
                setStartsAt(event.startsAt ? new Date(event.startsAt).toISOString().slice(0,16) : "");
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ event, groupId, isAdmin, isMeetup, canMessageAttendees, onDelete, onEdit }: { event: GroupEvent, groupId: number, isAdmin: boolean, isMeetup?: boolean, canMessageAttendees: boolean, onDelete: () => void, onEdit?: () => void }) {
  const [viewingAttendees, setViewingAttendees] = useState(false);
  const [guestCount, setGuestCount] = useState(0);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const rsvpMutation = useRsvpGroupEvent({
    mutation: {
      onSuccess: () => {
        toast({ title: "RSVP updated" });
        queryClient.invalidateQueries({ queryKey: getListGroupEventsQueryKey(groupId, { limit: 20 }) });
      },
      onError: () => toast({ title: "Failed to update RSVP", variant: "destructive" })
    }
  });

  const handleRsvp = (status: "going" | "interested" | "not_going") => {
    rsvpMutation.mutate({
      groupId,
      eventId: event.id,
      data: { rsvpStatus: status, guestCount: guestCount > 0 ? guestCount : undefined }
    });
  };

  const isGoing = event.viewerRsvpStatus === 'going';
  const isWaitlisted = event.viewerRsvpStatus === 'waitlisted';
  const isInterested = event.viewerRsvpStatus === 'interested';
  const isFull = event.attendeeLimit != null && event.rsvpCount >= event.attendeeLimit;

  // Display location based on new format
  const displayLocation = () => {
    if (event.eventFormat === 'online') return "Online Event";
    return event.location || event.venueName || event.city ? [event.venueName, event.city].filter(Boolean).join(", ") : "TBD";
  };

  return (
    <div className="bg-background/30 border border-white/5 p-4 rounded-xl flex flex-col gap-4 transition-all hover:border-orange-500/30">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        {event.imageUrl && (
          <img
            src={event.imageUrl}
            alt={`${event.title} event`}
            className="h-40 w-full rounded-lg object-cover md:h-32 md:w-48 shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h4 className="font-bold text-white text-lg line-clamp-1">{event.title}</h4>
            {(isAdmin || (isMeetup && canMessageAttendees)) && (
              <div className="flex gap-1 shrink-0 ml-2">
                {isMeetup && canMessageAttendees && (
                  <BroadcastAttendeesDialog groupId={groupId} event={event} />
                )}
                {!isMeetup && onEdit && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-primary hover:text-primary/80" onClick={onEdit}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onDelete}><Trash2 className="w-4 h-4" /></Button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-orange-400 font-medium mb-3">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {new Date(event.startsAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
            <span className="flex items-center gap-1 text-white/60">
              {event.eventFormat === 'online' ? <Video className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
              {displayLocation()}
            </span>
            {event.isPaid && (
              <span className="flex items-center gap-1 text-emerald-400">
                <DollarSign className="w-3.5 h-3.5" /> Paid Event
              </span>
            )}
          </div>

          {event.description && <p className="text-sm text-white/70 mb-4 line-clamp-2">{event.description}</p>}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 text-white/60">
                <Users className="w-3.5 h-3.5 text-orange-500/50" />
                {event.rsvpCount} {event.attendeeLimit ? `/ ${event.attendeeLimit}` : ''} Going
              </span>
              {!event.hideAttendees && (
                <Button variant="link" size="sm" className="h-auto p-0 text-xs text-orange-400" onClick={() => setViewingAttendees(!viewingAttendees)}>
                  See Attendees
                </Button>
              )}
            </div>

            {event.onlineUrl && isGoing && (
              <Button size="sm" variant="outline" className="h-8 border-orange-500/30 text-orange-400 bg-orange-500/10" asChild>
                <a href={event.onlineUrl} target="_blank" rel="noopener noreferrer"><LinkIcon className="w-3.5 h-3.5 mr-1.5" /> Join Meeting</a>
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 shrink-0 md:w-36">
          {event.isPaid ? (
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-2 text-center">
              <p className="text-xs font-medium text-orange-400 mb-1">Paid Event</p>
              <p className="text-[10px] text-white/50 leading-tight">Checkout not available. Pay at door.</p>
            </div>
          ) : (
            <>
              {event.allowGuests && !isGoing && !isWaitlisted && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-white/60">Guests:</span>
                  <Input type="number" min={0} max={event.maxGuestsPerRsvp || 1} value={guestCount} onChange={e => setGuestCount(parseInt(e.target.value) || 0)} className="h-6 w-12 text-xs px-1 text-center bg-background border-white/10" />
                </div>
              )}

              {!isGoing && !isWaitlisted && (
                <Button
                  size="sm"
                  onClick={() => handleRsvp('going')}
                  disabled={rsvpMutation.isPending || (isFull && !event.waitlistEnabled)}
                  className={isFull && event.waitlistEnabled ? "bg-amber-600 hover:bg-amber-500" : "bg-orange-600 hover:bg-orange-500 text-white"}
                >
                  {isFull ? (event.waitlistEnabled ? "Join Waitlist" : "Event Full") : "Attend"}
                </Button>
              )}

              {isGoing && (
                <Button size="sm" variant="outline" className="border-green-500/30 bg-green-500/10 text-green-400 pointer-events-none">
                  <Check className="w-3.5 h-3.5 mr-1" /> Going
                </Button>
              )}

              {isWaitlisted && (
                <Button size="sm" variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 pointer-events-none">
                  <Clock className="w-3.5 h-3.5 mr-1" /> Waitlisted
                </Button>
              )}

              {(isGoing || isWaitlisted || isInterested) && (
                <Button size="sm" variant="ghost" onClick={() => handleRsvp('not_going')} disabled={rsvpMutation.isPending} className="text-white/50 hover:text-white">
                  Cancel RSVP
                </Button>
              )}

              {!isGoing && !isWaitlisted && !isInterested && (
                <Button size="sm" variant="outline" onClick={() => handleRsvp('interested')} disabled={rsvpMutation.isPending} className="border-white/10 hover:bg-white/5">
                  Interested
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {viewingAttendees && (
        <AttendeesView groupId={groupId} eventId={event.id} isAdmin={isAdmin} />
      )}
    </div>
  );
}

function getBroadcastErrorMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    error.data &&
    typeof error.data === "object" &&
    "error" in error.data &&
    typeof error.data.error === "string"
  ) {
    const retryAfterSeconds =
      "retryAfterSeconds" in error.data && typeof error.data.retryAfterSeconds === "number"
        ? error.data.retryAfterSeconds
        : null;
    if (retryAfterSeconds) {
      const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
      return `${error.data.error}. Try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
    }
    return error.data.error;
  }
  return "The attendee update could not be sent. Please try again.";
}

function BroadcastAttendeesDialog({ groupId, event }: { groupId: number; event: GroupEvent }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<GroupEventBroadcastResult | null>(null);
  const { toast } = useToast();
  const audienceQueryKey = getGetGroupEventBroadcastAudienceQueryKey(groupId, event.id);
  const audience = useGetGroupEventBroadcastAudience(groupId, event.id, {
    query: {
      queryKey: audienceQueryKey,
      enabled: open,
      staleTime: 0,
    },
  });
  const broadcast = useBroadcastGroupEvent({
    mutation: {
      onSuccess: (deliveryResult) => {
        setResult(deliveryResult);
        if (deliveryResult.status === "sent") {
          toast({
            title: "Update delivered",
            description: `Sent to ${deliveryResult.deliveredCount} confirmed ${deliveryResult.deliveredCount === 1 ? "attendee" : "attendees"}.`,
          });
        } else if (deliveryResult.status === "partial") {
          toast({
            title: "Update partially delivered",
            description: `${deliveryResult.deliveredCount} delivered, ${deliveryResult.failedCount} failed.`,
            variant: "destructive",
          });
        } else if (deliveryResult.status === "failed") {
          toast({
            title: "Delivery failed",
            description: `The update could not be delivered to ${deliveryResult.failedCount} ${deliveryResult.failedCount === 1 ? "attendee" : "attendees"}.`,
            variant: "destructive",
          });
        }
      },
      onError: (error) => {
        toast({
          title: "Update not sent",
          description: getBroadcastErrorMessage(error),
          variant: "destructive",
        });
      },
    },
  });

  const recipientCount = audience.data?.recipientCount ?? 0;
  const canSend =
    message.trim().length > 0 &&
    message.length <= 500 &&
    recipientCount > 0 &&
    !audience.isLoading &&
    !broadcast.isPending;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setMessage("");
      setResult(null);
      broadcast.reset();
    }
  };

  const handleSend = () => {
    if (!canSend) return;
    setResult(null);
    broadcast.mutate({
      groupId,
      eventId: event.id,
      data: { message: message.trim() },
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-orange-400 hover:text-orange-300"
          aria-label={`Message confirmed attendees for ${event.title}`}
          data-testid={`message-attendees-${event.id}`}
        >
          <Megaphone className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-card text-white">
        <DialogHeader>
          <DialogTitle>Message confirmed attendees</DialogTitle>
          <DialogDescription>
            Send one in-app update to eligible members currently marked Going for “{event.title}”.
            Waitlisted, private, blocked, removed, and cancelled members are excluded.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div
            className={`rounded-xl border p-4 ${
              result.status === "sent"
                ? "border-emerald-500/30 bg-emerald-500/10"
                : result.status === "partial"
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "border-red-500/30 bg-red-500/10"
            }`}
            data-testid="broadcast-result"
          >
            <div className="flex items-start gap-3">
              {result.status === "sent" ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              )}
              <div>
                <p className="font-medium">
                  {result.status === "sent"
                    ? "Update delivered"
                    : result.status === "partial"
                      ? "Some deliveries failed"
                      : result.status === "no_recipients"
                        ? "No eligible attendees"
                        : "Delivery failed"}
                </p>
                <p className="mt-1 text-sm text-white/70">
                  {result.deliveredCount} of {result.recipientCount} delivered
                  {result.failedCount > 0 ? ` · ${result.failedCount} failed` : ""}
                  {result.skippedCount > 0 ? ` · ${result.skippedCount} no longer eligible` : ""}.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-sm text-orange-100">
              {audience.isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking the current audience…
                </span>
              ) : audience.isError ? (
                "Recipient count is unavailable. Close and try again."
              ) : (
                `${recipientCount} confirmed ${recipientCount === 1 ? "attendee" : "attendees"} will receive this update.`
              )}
            </div>
            <div className="space-y-2">
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={500}
                rows={6}
                placeholder="Share a reminder, venue detail, or last-minute update…"
                className="resize-none border-white/10 bg-background/60"
                data-testid="broadcast-message"
              />
              <p className="text-right text-xs text-white/40">{message.length}/500</p>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
          {!result && (
            <Button
              onClick={handleSend}
              disabled={!canSend}
              className="bg-orange-600 text-white hover:bg-orange-500"
              data-testid="send-broadcast"
            >
              {broadcast.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
                </>
              ) : (
                <>
                  <Megaphone className="mr-2 h-4 w-4" /> Send update
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttendeesView({ groupId, eventId, isAdmin }: { groupId: number, eventId: number, isAdmin: boolean }) {
  const { data: attendees, isLoading } = useListGroupEventAttendees(groupId, eventId, {
    query: { queryKey: getListGroupEventAttendeesQueryKey(groupId, eventId) }
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const manageAttendee = useManageGroupEventAttendee({
    mutation: {
      onSuccess: () => {
        toast({ title: "Attendee updated" });
        queryClient.invalidateQueries({ queryKey: getListGroupEventAttendeesQueryKey(groupId, eventId) });
        queryClient.invalidateQueries({ queryKey: getListGroupEventsQueryKey(groupId, { limit: 20 }) });
      },
      onError: () => toast({ title: "Failed to update attendee", variant: "destructive" })
    }
  });

  const handleAction = (userId: number, action: 'set_going' | 'set_waitlisted' | 'check_in' | 'mark_no_show' | 'mark_not_coming' | 'cancel') => {
    manageAttendee.mutate({ groupId, eventId, userId, data: { action } });
  };

  if (isLoading) return <div className="mt-4 pt-4 border-t border-white/5 h-20 animate-pulse bg-white/5 rounded-lg" />;

  const filtered = attendees?.filter(a => a.userName?.toLowerCase().includes(search.toLowerCase())) || [];

  const going = filtered.filter(a => a.rsvpStatus === 'going');
  const waitlisted = filtered.filter(a => a.rsvpStatus === 'waitlisted');
  const other = filtered.filter(a => a.rsvpStatus !== 'going' && a.rsvpStatus !== 'waitlisted');

  return (
    <div className="mt-4 pt-4 border-t border-white/5 animate-in fade-in slide-in-from-top-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <h5 className="text-sm font-bold text-white">Attendee List</h5>
        {isAdmin && (
          <div className="relative w-full sm:w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-8 pl-8 text-xs bg-background/50 border-white/10"
            />
          </div>
        )}
      </div>

      {!attendees || attendees.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No attendees yet.</p>
      ) : (
        <div className="space-y-6">
          {going.length > 0 && (
            <div>
              <h6 className="text-xs font-medium text-green-400 mb-2">Going ({going.length})</h6>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {going.map(a => (
                  <AttendeeCard key={a.userId} attendee={a as any} isAdmin={isAdmin} onAction={(action) => handleAction(a.userId, action)} />
                ))}
              </div>
            </div>
          )}

          {waitlisted.length > 0 && (
            <div>
              <h6 className="text-xs font-medium text-amber-400 mb-2">Waitlisted ({waitlisted.length})</h6>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {waitlisted.map(a => (
                  <AttendeeCard key={a.userId} attendee={a as any} isAdmin={isAdmin} onAction={(action) => handleAction(a.userId, action)} />
                ))}
              </div>
            </div>
          )}

          {isAdmin && other.length > 0 && (
            <div>
              <h6 className="text-xs font-medium text-white/40 mb-2">Other ({other.length})</h6>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 opacity-60">
                {other.map(a => (
                  <AttendeeCard key={a.userId} attendee={a as any} isAdmin={isAdmin} onAction={(action) => handleAction(a.userId, action)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AttendeeCard({ attendee, isAdmin, onAction }: { attendee: any, isAdmin: boolean, onAction: (action: any) => void }) {
  return (
    <div className="bg-background/40 border border-white/5 rounded-lg p-2 flex items-center justify-between">
      <div className="flex items-center gap-2 overflow-hidden">
        <div className="h-8 w-8 rounded-full bg-white/5 shrink-0 overflow-hidden">
          {attendee.userPhotoUrl ? <img src={attendee.userPhotoUrl} className="w-full h-full object-cover" /> : <Users2 className="w-4 h-4 m-auto mt-2 text-white/30" />}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-white truncate">{attendee.userName}</p>
          <div className="flex gap-2 text-[10px] text-white/50 mt-0.5">
            {attendee.guestCount > 0 && <span>+{attendee.guestCount} guests</span>}
            {attendee.attendanceStatus === 'checked_in' && <span className="text-green-400">Checked In</span>}
            {attendee.attendanceStatus === 'no_show' && <span className="text-red-400">No Show</span>}
          </div>
        </div>
      </div>

      {isAdmin && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-white/50 hover:text-white shrink-0">
              <MoreHorizontal className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 bg-card border-white/10 text-xs">
            {attendee.rsvpStatus === 'waitlisted' && (
              <DropdownMenuItem onClick={() => onAction('set_going')}>Promote to Going</DropdownMenuItem>
            )}
            {attendee.rsvpStatus === 'going' && (
              <>
                <DropdownMenuItem onClick={() => onAction('check_in')}>Mark Checked-In</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction('mark_no_show')}>Mark No-Show</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction('set_waitlisted')}>Move to Waitlist</DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem className="text-destructive" onClick={() => onAction('cancel')}>Remove RSVP</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
