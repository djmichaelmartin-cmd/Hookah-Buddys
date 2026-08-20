import { useState } from "react";
import { 
  useListGroupEvents, 
  useRsvpGroupEvent, 
  useCreateGroupEvent,
  useUpdateGroupEvent,
  useDeleteGroupEvent,
  useListGroupEventAttendees,
  getListGroupEventsQueryKey,
  getListGroupEventAttendeesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, MapPin, Plus, Trash2, Edit2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function GroupEvents({ groupId, isAdmin }: { groupId: number, isAdmin: boolean }) {
  const { data: events, isLoading } = useListGroupEvents(groupId, { limit: 20 });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingAttendeesId, setViewingAttendeesId] = useState<number | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [locationStr, setLocationStr] = useState("");
  const [startsAt, setStartsAt] = useState("");

  const rsvpMutation = useRsvpGroupEvent({
    mutation: {
      onSuccess: () => {
        toast({ title: "RSVP updated" });
        queryClient.invalidateQueries({ queryKey: getListGroupEventsQueryKey(groupId, { limit: 20 }) }); 
      },
      onError: () => toast({ title: "Failed to update RSVP", variant: "destructive" })
    }
  });

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

  const { data: attendees } = useListGroupEventAttendees(groupId, viewingAttendeesId!, {
    query: { enabled: !!viewingAttendeesId, queryKey: viewingAttendeesId ? getListGroupEventAttendeesQueryKey(groupId, viewingAttendeesId) : [] }
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
          <Button size="sm" onClick={() => { resetForm(); setIsAdding(true); }} data-testid="add-event-btn">
            <Plus className="w-4 h-4 mr-2" /> Create Event
          </Button>
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
          <p>No upcoming events for this group.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map(event => (
            <div key={event.id} className="bg-background/30 border border-white/5 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
              {event.imageUrl && (
                <img
                  src={event.imageUrl}
                  alt={`${event.title} event`}
                  className="h-36 w-full rounded-lg object-cover md:h-28 md:w-40"
                  data-testid={`group-event-image-${event.id}`}
                />
              )}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-bold text-white">{event.title}</h4>
                  {isAdmin && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => {
                        setTitle(event.title);
                        setDescription(event.description || "");
                        setLocationStr(event.location || "");
                        setStartsAt(new Date(event.startsAt).toISOString().slice(0, 16));
                        setEditingId(event.id);
                      }}><Edit2 className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteEvent.mutate({ groupId, eventId: event.id })}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-primary mb-2">{new Date(event.startsAt).toLocaleString()}</p>
                {event.description && <p className="text-sm text-white/70 mb-3">{event.description}</p>}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {event.location || "TBD"}
                  </p>
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setViewingAttendeesId(viewingAttendeesId === event.id ? null : event.id)}>
                    <Users className="w-3 h-3 mr-1" /> Attendees
                  </Button>
                </div>
                
                {viewingAttendeesId === event.id && (
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <h5 className="text-xs font-bold text-white mb-2">Attendees</h5>
                    {!attendees || attendees.length === 0 ? <p className="text-xs text-muted-foreground">No attendees yet.</p> : (
                      <div className="flex flex-wrap gap-2">
                        {attendees.map(a => (
                          <div key={a.userId} className="text-xs bg-background/50 px-2 py-1 rounded-md flex items-center gap-2 text-white">
                            <span>{a.userName}</span>
                            <span className="text-muted-foreground">({a.rsvpStatus})</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0 md:flex-col lg:flex-row">
                <Button size="sm" onClick={() => rsvpMutation.mutate({ groupId, eventId: event.id, data: { rsvpStatus: 'going' } })} disabled={rsvpMutation.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">Going</Button>
                <Button size="sm" variant="outline" onClick={() => rsvpMutation.mutate({ groupId, eventId: event.id, data: { rsvpStatus: 'interested' } })} disabled={rsvpMutation.isPending} className="border-white/10 hover:bg-white/5">Interested</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
