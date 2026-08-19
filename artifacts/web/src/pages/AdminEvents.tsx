import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import {
  useListAdminEvents,
  useCreateAdminEvent,
  useUpdateAdminEvent,
  useDeleteAdminEvent,
  getListAdminEventsQueryKey,
  useListLounges,
  getListLoungesQueryKey,
  type Event,
  type Lounge,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, MapPin, X, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type EventFormState = {
  title: string;
  description: string;
  loungeId: number | null;
  loungeName: string; // display-only label for a linked lounge
  venueName: string;
  city: string;
  state: string;
  startsAt: string; // datetime-local value
  endsAt: string;
  imageUrl: string;
};

function emptyForm(): EventFormState {
  return {
    title: "",
    description: "",
    loungeId: null,
    loungeName: "",
    venueName: "",
    city: "",
    state: "",
    startsAt: "",
    endsAt: "",
    imageUrl: "",
  };
}

function LoungePicker({
  form,
  setForm,
}: {
  form: EventFormState;
  setForm: (updater: (prev: EventFormState) => EventFormState) => void;
}) {
  const [search, setSearch] = useState("");
  const trimmed = search.trim();
  const params = { q: trimmed, limit: 8 };
  const { data: results, isFetching } = useListLounges(params, {
    query: {
      queryKey: getListLoungesQueryKey(params),
      enabled: trimmed.length >= 2,
    },
  });

  const pick = (lounge: Lounge) => {
    setForm((prev) => ({
      ...prev,
      loungeId: lounge.id,
      loungeName: lounge.name,
      venueName: lounge.name,
      city: lounge.city,
      state: lounge.state,
    }));
    setSearch("");
  };

  const clear = () =>
    setForm((prev) => ({ ...prev, loungeId: null, loungeName: "" }));

  if (form.loungeId != null) {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">Linked lounge</Label>
        <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-md bg-background border border-white/10">
          <MapPin className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm text-white truncate">
            {form.loungeName || form.venueName || `Lounge #${form.loungeId}`}
          </span>
          <button
            type="button"
            onClick={clear}
            aria-label="Unlink lounge"
            className="ml-auto text-muted-foreground hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Venue, city, and state were filled from the directory. Unlink to enter them manually.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Label className="text-xs text-muted-foreground">Lounge (optional — search the directory)</Label>
      <div className="relative mt-1">
        <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lounges by name or city…"
          className="bg-background border-white/10 pl-9"
        />
      </div>
      {trimmed.length >= 2 && (
        <div className="mt-1 rounded-md border border-white/10 bg-background overflow-hidden">
          {isFetching && !results && (
            <p className="text-xs text-muted-foreground px-3 py-2">Searching…</p>
          )}
          {results && results.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-2">
              No lounges match. You can enter the venue manually below.
            </p>
          )}
          {(results ?? []).map((lounge) => (
            <button
              key={lounge.id}
              type="button"
              onClick={() => pick(lounge)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0"
            >
              <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-sm text-white truncate">{lounge.name}</span>
              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                {lounge.city}, {lounge.state}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EventFields({
  form,
  setForm,
}: {
  form: EventFormState;
  setForm: (updater: (prev: EventFormState) => EventFormState) => void;
}) {
  const set = (key: keyof EventFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-muted-foreground">Title</Label>
        <Input value={form.title} onChange={set("title")} className="bg-background border-white/10" />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Description</Label>
        <Textarea value={form.description} onChange={set("description")} rows={2} className="bg-background border-white/10" />
      </div>
      <LoungePicker form={form} setForm={setForm} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Venue</Label>
          <Input value={form.venueName} onChange={set("venueName")} className="bg-background border-white/10" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">City</Label>
          <Input value={form.city} onChange={set("city")} className="bg-background border-white/10" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">State (2 letters)</Label>
          <Input value={form.state} onChange={set("state")} maxLength={2} className="bg-background border-white/10" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Starts</Label>
          <Input type="datetime-local" value={form.startsAt} onChange={set("startsAt")} className="bg-background border-white/10" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Ends (optional)</Label>
          <Input type="datetime-local" value={form.endsAt} onChange={set("endsAt")} className="bg-background border-white/10" />
        </div>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Image URL (optional)</Label>
        <Input value={form.imageUrl} onChange={set("imageUrl")} className="bg-background border-white/10" />
      </div>
    </div>
  );
}

function validateForm(form: EventFormState): string | null {
  if (form.title.trim() === "") return "Title is required.";
  if (form.city.trim() === "") return "City is required.";
  if (form.state.trim().length !== 2) return "State must be a 2-letter code.";
  if (!toIso(form.startsAt)) return "A valid start date/time is required.";
  return null;
}

function EventRow({ event }: { event: Event }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EventFormState>(() => ({
    title: event.title,
    description: event.description ?? "",
    loungeId: event.loungeId ?? null,
    loungeName: "",
    venueName: event.venueName ?? "",
    city: event.city,
    state: event.state,
    startsAt: toLocalInputValue(event.startsAt),
    endsAt: toLocalInputValue(event.endsAt),
    imageUrl: event.imageUrl ?? "",
  }));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListAdminEventsQueryKey() });

  const update = useUpdateAdminEvent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Event updated" });
        setEditing(false);
        invalidate();
      },
      onError: () =>
        toast({ title: "Update failed", description: "Please try again.", variant: "destructive" }),
    },
  });
  const del = useDeleteAdminEvent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Event deleted" });
        invalidate();
      },
      onError: () =>
        toast({ title: "Delete failed", description: "Please try again.", variant: "destructive" }),
    },
  });

  const save = () => {
    const error = validateForm(form);
    if (error) {
      toast({ title: "Check the form", description: error, variant: "destructive" });
      return;
    }
    update.mutate({
      id: event.id,
      data: {
        title: form.title.trim(),
        description: form.description.trim() === "" ? null : form.description,
        loungeId: form.loungeId,
        venueName: form.venueName.trim() === "" ? null : form.venueName.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        startsAt: toIso(form.startsAt)!,
        endsAt: toIso(form.endsAt),
        imageUrl: form.imageUrl.trim() === "" ? null : form.imageUrl.trim(),
      },
    });
  };

  const toggleStatus = () =>
    update.mutate({
      id: event.id,
      data: { status: event.status === "active" ? "cancelled" : "active" },
    });

  const isPast = new Date(event.startsAt).getTime() < Date.now();

  return (
    <div className="bg-card/50 border border-white/10 rounded-xl p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-white font-medium truncate">{event.title}</p>
          <Badge
            variant="outline"
            className={
              event.status === "active"
                ? "border-green-500/40 text-green-400"
                : "border-destructive/40 text-destructive"
            }
          >
            {event.status}
          </Badge>
          {isPast && (
            <Badge variant="outline" className="border-white/10 text-muted-foreground">past</Badge>
          )}
        </div>
        <span className="text-sm text-muted-foreground shrink-0">{event.rsvpCount} RSVPs</span>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        {new Date(event.startsAt).toLocaleString()} · {event.venueName ? `${event.venueName}, ` : ""}
        {event.city}, {event.state}
      </p>

      {editing && (
        <div className="mb-4">
          <EventFields form={form} setForm={setForm} />
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => del.mutate({ id: event.id })}
          disabled={del.isPending}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="w-4 h-4 mr-1" /> Delete
        </Button>
        <Button variant="outline" size="sm" onClick={toggleStatus} disabled={update.isPending} className="border-white/10">
          {event.status === "active" ? "Cancel event" : "Reactivate"}
        </Button>
        {editing ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setEditing(false)} className="border-white/10">
              Close
            </Button>
            <Button size="sm" onClick={save} disabled={update.isPending} className="bg-primary text-primary-foreground">
              {update.isPending ? "Saving..." : "Save changes"}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="border-white/10">
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AdminEvents() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: events, isLoading } = useListAdminEvents();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<EventFormState>(emptyForm());

  const create = useCreateAdminEvent({
    mutation: {
      onSuccess: (created) => {
        toast({ title: "Event created", description: `${created.title} is live in the Lounge sidebar.` });
        setCreating(false);
        setForm(emptyForm());
        queryClient.invalidateQueries({ queryKey: getListAdminEventsQueryKey() });
      },
      onError: () =>
        toast({ title: "Create failed", description: "Please try again.", variant: "destructive" }),
    },
  });

  const submitCreate = () => {
    const error = validateForm(form);
    if (error) {
      toast({ title: "Check the form", description: error, variant: "destructive" });
      return;
    }
    create.mutate({
      data: {
        title: form.title.trim(),
        description: form.description.trim() === "" ? undefined : form.description,
        loungeId: form.loungeId ?? undefined,
        venueName: form.venueName.trim() === "" ? undefined : form.venueName.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        startsAt: toIso(form.startsAt)!,
        endsAt: toIso(form.endsAt),
        imageUrl: form.imageUrl.trim() === "" ? undefined : form.imageUrl.trim(),
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-serif text-white">Hookah Events</h2>
          <p className="text-sm text-muted-foreground">
            Create and manage events shown in the Lounge sidebar. Members can RSVP and save them.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating((v) => !v)} className="bg-primary text-primary-foreground shrink-0">
          <Plus className="w-4 h-4 mr-1" /> New event
        </Button>
      </div>

      {creating && (
        <div className="bg-card/50 border border-white/10 rounded-xl p-5">
          <EventFields form={form} setForm={setForm} />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setCreating(false)} className="border-white/10">
              Cancel
            </Button>
            <Button size="sm" onClick={submitCreate} disabled={create.isPending} className="bg-primary text-primary-foreground">
              {create.isPending ? "Creating..." : "Create event"}
            </Button>
          </div>
        </div>
      )}

      {isLoading && <p className="text-muted-foreground">Loading events…</p>}

      <div className="space-y-4">
        {(events ?? []).map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>

      {!isLoading && (events ?? []).length === 0 && (
        <p className="text-muted-foreground">No events yet. Create the first one.</p>
      )}
    </div>
  );
}
