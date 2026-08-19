import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Calendar, MapPin, ExternalLink } from "lucide-react";
import {  
  useListBusinessEvents,
  useUpsertBusinessEvent,
  useDeleteBusinessEvent,
  getListBusinessEventsQueryKey
, BusinessDetail, BusinessEvent } from "@workspace/api-client-react";

export function DashboardEvents({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({ title: "", description: "", location: "", startsAt: "", endsAt: "", ticketUrl: "" });

  const { data: events, isLoading } = useListBusinessEvents(business.handle, {
    query: { enabled: !!business.handle, queryKey: getListBusinessEventsQueryKey(business.handle) }
  });

  const upsertEvent = useUpsertBusinessEvent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Event saved" });
        setIsAdding(false);
        setFormData({ title: "", description: "", location: "", startsAt: "", endsAt: "", ticketUrl: "" });
        queryClient.invalidateQueries({ queryKey: getListBusinessEventsQueryKey(business.handle) });
      },
      onError: (err: unknown) => toast({ title: "Failed to save", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const deleteEvent = useDeleteBusinessEvent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Event deleted" });
        queryClient.invalidateQueries({ queryKey: getListBusinessEventsQueryKey(business.handle) });
      }
    }
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.startsAt) return;
    
    upsertEvent.mutate({ 
      handle: business.handle, 
      data: { 
        ...formData, 
        startsAt: new Date(formData.startsAt).toISOString(),
        endsAt: formData.endsAt ? new Date(formData.endsAt).toISOString() : undefined 
      } 
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          <Calendar className="w-5 h-5 text-[#D6B56D]" /> Events
        </h3>
        <Button onClick={() => setIsAdding(!isAdding)} variant="outline" className="rounded-full border-white/20 text-white">
          {isAdding ? "Cancel" : <><Plus className="w-4 h-4 mr-2" /> Create Event</>}
        </Button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-card/50 border border-[#D6B56D]/50 rounded-2xl p-6 mb-6 animate-in fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Title</label>
              <Input required value={formData.title} onChange={e => setFormData(p => ({...p, title: e.target.value}))} className="bg-background border-white/10" placeholder="e.g. Live DJ Night" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Location</label>
              <Input value={formData.location} onChange={e => setFormData(p => ({...p, location: e.target.value}))} className="bg-background border-white/10" placeholder="e.g. Main Stage" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Starts At</label>
              <Input type="datetime-local" required value={formData.startsAt} onChange={e => setFormData(p => ({...p, startsAt: e.target.value}))} className="bg-background border-white/10" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Ends At (optional)</label>
              <Input type="datetime-local" value={formData.endsAt} onChange={e => setFormData(p => ({...p, endsAt: e.target.value}))} className="bg-background border-white/10" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Ticket/RSVP URL (optional)</label>
              <Input type="url" value={formData.ticketUrl} onChange={e => setFormData(p => ({...p, ticketUrl: e.target.value}))} className="bg-background border-white/10" placeholder="https://..." />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-white/60 mb-1">Description</label>
              <Textarea value={formData.description} onChange={e => setFormData(p => ({...p, description: e.target.value}))} className="bg-background border-white/10 min-h-[80px]" placeholder="Event details..." />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={upsertEvent.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-6">
              {upsertEvent.isPending ? "Saving..." : "Save Event"}
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-white/50">Loading events...</div>
      ) : !events || events.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <Calendar className="w-12 h-12 mx-auto mb-4 text-white/10" />
          <p className="text-white/50">No upcoming events.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {events.map((ev: BusinessEvent) => (
            <div key={ev.id} className="bg-card border border-white/10 p-5 rounded-2xl relative group">
              <h4 className="font-bold text-white text-lg pr-8">{ev.title}</h4>
              <div className="space-y-2 mt-3 text-sm text-white/80">
                <p className="flex items-center gap-2"><Calendar className="w-4 h-4 text-[#D6B56D]" /> {new Date(ev.startsAt).toLocaleString()}</p>
                {ev.location && <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-[#D6B56D]" /> {ev.location}</p>}
                {ev.ticketUrl && <p className="flex items-center gap-2"><ExternalLink className="w-4 h-4 text-[#D6B56D]" /> <a href={ev.ticketUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Tickets</a></p>}
              </div>
              {ev.description && <p className="mt-3 text-sm text-white/60 line-clamp-2">{ev.description}</p>}
              <div className="mt-4 pt-3 border-t border-white/10 flex justify-between items-center text-xs text-white/40">
                <span>{ev.rsvpCount || 0} RSVPs</span>
                <span className="uppercase tracking-wider px-2 py-1 bg-white/5 rounded">{ev.status}</span>
              </div>

              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="icon" variant="ghost" onClick={() => deleteEvent.mutate({ handle: business.handle, eventId: ev.id })} className="text-destructive hover:bg-destructive/20">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
