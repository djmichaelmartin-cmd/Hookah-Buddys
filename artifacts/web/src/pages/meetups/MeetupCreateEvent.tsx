import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { Layout } from "@/components/Layout";
import {
  getGetGroupQueryKey,
  getListEditableReelBusinessesQueryKey,
  getListGroupEventsQueryKey,
  useCreateGroupEvent,
  useGetCurrentUser,
  useGetGroup,
  useListEditableReelBusinesses,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { CalendarPlus, MapPin, Image as ImageIcon, Link as LinkIcon, DollarSign, SwitchCamera, Info, Store, Users } from "lucide-react";
import { uploadImage } from "@/lib/uploadImage";
import { getErrorMessage } from "@/lib/error";
import { meetupHostType, trackEvent } from "@/lib/analytics";

const createEventSchema = z.object({
  title: z.string().min(1, "Event title is required").max(100),
  description: z.string().max(2000).optional(),
  eventFormat: z.enum(["in_person", "online", "hybrid"]),
  venueName: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  onlineUrl: z.string()
    .url("Must be a valid URL")
    .refine((value) => !value || /^https?:\/\//i.test(value), "Meeting link must start with http:// or https://")
    .optional()
    .or(z.literal("")),
  onlineUrlProtected: z.boolean().default(false),
  startsAt: z.string().min(1, "Start time is required"),
  endsAt: z.string().optional(),
  visibility: z.enum(["public", "private"]),
  hideAttendees: z.boolean().default(false),
  isPaid: z.boolean().default(false),
  attendeeLimit: z.coerce.number().min(1).optional().or(z.literal(0)),
  waitlistEnabled: z.boolean().default(false),
  allowGuests: z.boolean().default(false),
  maxGuestsPerRsvp: z.coerce.number().min(0).optional(),
  eventCategory: z.string().optional(),
  howToFind: z.string().max(500).optional(),
  communityConfirmation: z.boolean().refine(val => val === true, "You must agree to host a responsible event"),
}).superRefine((data, ctx) => {
  if (["in_person", "hybrid"].includes(data.eventFormat)) {
    if (!data.city || !data.state) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["city"],
        message: "City and state are required for physical events",
      });
    }
  }
  if (["online", "hybrid"].includes(data.eventFormat) && !data.onlineUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["onlineUrl"],
      message: "Meeting link is required for online events",
    });
  }
});

type CreateEventForm = z.infer<typeof createEventSchema>;

export default function MeetupCreateEvent() {
  const [match, params] = useRoute("/meetups/:id/create-event");
  const groupId = parseInt(params?.id || "0", 10);
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [businessId, setBusinessId] = useState<number | null>(null);
  const { data: session } = useGetCurrentUser();
  const {
    data: managedBusinesses,
    isLoading: areBusinessesLoading,
    isError: businessesLoadFailed,
  } = useListEditableReelBusinesses(undefined, {
    query: {
      enabled: !!session?.authenticated,
      queryKey: getListEditableReelBusinessesQueryKey(),
    },
  });

  const { data: group, isLoading: isGroupLoading } = useGetGroup(groupId, {
    query: { enabled: !!groupId, queryKey: getGetGroupQueryKey(groupId) },
  });

  const createEvent = useCreateGroupEvent({
    mutation: {
      onSuccess: () => {
        trackEvent("meetup_event_published", {
          host_type: meetupHostType(businessId),
        });
        toast({ title: "Event successfully scheduled!" });
        queryClient.invalidateQueries({ queryKey: getListGroupEventsQueryKey(groupId) });
        setLocation(`/meetups/${groupId}`);
      },
      onError: (err) => {
        toast({ title: "Failed to create event", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const form = useForm<CreateEventForm>({
    resolver: zodResolver(createEventSchema),
    defaultValues: {
      title: "",
      description: "",
      eventFormat: "in_person",
      venueName: "",
      address: "",
      city: "",
      state: "",
      onlineUrl: "",
      onlineUrlProtected: false,
      startsAt: "",
      endsAt: "",
      visibility: "public",
      hideAttendees: false,
      isPaid: false,
      attendeeLimit: 0,
      waitlistEnabled: false,
      allowGuests: false,
      maxGuestsPerRsvp: 1,
      eventCategory: "",
      howToFind: "",
      communityConfirmation: false,
    }
  });

  if (isGroupLoading) return <Layout><div className="min-h-screen animate-pulse bg-background" /></Layout>;

  if (!group) {
    return <Layout><div className="container mx-auto py-12 text-center">Meetup not found.</div></Layout>;
  }

  if (group.groupType !== 'meetup') {
    return <Layout><div className="container mx-auto py-12 text-center">This group is not a meetup.</div></Layout>;
  }

  const onSubmit = async (data: CreateEventForm) => {
    setIsUploading(true);
    try {
      let imageUrl;
      if (coverFile) {
        imageUrl = await uploadImage(coverFile);
      }

      await createEvent.mutateAsync({
        groupId,
        data: {
          title: data.title,
          ...(businessId ? { businessId } : {}),
          description: data.description || undefined,
          eventFormat: data.eventFormat,
          venueName: data.venueName || undefined,
          address: data.address || undefined,
          city: data.city || undefined,
          state: data.state || undefined,
          location: data.address ? `${data.address}, ${data.city}, ${data.state}` : (data.city ? `${data.city}, ${data.state}` : undefined),
          onlineUrl: ["online", "hybrid"].includes(data.eventFormat) ? data.onlineUrl : undefined,
          onlineUrlProtected: data.onlineUrlProtected,
          imageUrl,
          startsAt: new Date(data.startsAt).toISOString(),
          endsAt: data.endsAt ? new Date(data.endsAt).toISOString() : undefined,
          visibility: data.visibility as any,
          hideAttendees: data.hideAttendees,
          isPaid: data.isPaid,
          paidMetadata: data.isPaid ? { provider: 'manual' } : undefined,
          attendeeLimit: data.attendeeLimit && data.attendeeLimit > 0 ? data.attendeeLimit : undefined,
          waitlistEnabled: data.waitlistEnabled,
          allowGuests: data.allowGuests,
          maxGuestsPerRsvp: data.allowGuests ? (data.maxGuestsPerRsvp || 1) : undefined,
          eventCategory: data.eventCategory || undefined,
          howToFind: data.howToFind || undefined,
        }
      });
      
    } catch (err: unknown) {
      // Handled in onError of mutation config
    } finally {
      setIsUploading(false);
    }
  };

  const eventFormat = form.watch("eventFormat");
  const isPaid = form.watch("isPaid");
  const allowGuests = form.watch("allowGuests");

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <Link href={`/meetups/${groupId}`} className="text-sm text-orange-500 hover:text-orange-400 mb-4 inline-block">
            &larr; Back to {group.name}
          </Link>
          <h1 className="font-serif text-4xl text-white font-bold mb-3 flex items-center gap-3 drop-shadow-md">
            <span className="bg-orange-500/20 p-3 rounded-2xl border border-orange-500/40">
              <CalendarPlus className="w-8 h-8 text-orange-500" />
            </span>
            Schedule an Event
          </h1>
          <p className="text-white/70 text-lg ml-[4.5rem]">Plan the next session for your meetup members.</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">Host & Organizer</h2>
              <RadioGroup
                value={businessId == null ? "self" : String(businessId)}
                onValueChange={(value) => setBusinessId(value === "self" ? null : Number(value))}
                className="grid gap-3"
                data-testid="meetup-event-host-picker"
              >
                <label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-orange-500/20 bg-background/50 p-4 transition-colors has-[[data-state=checked]]:border-orange-500/60 has-[[data-state=checked]]:bg-orange-500/5">
                  <RadioGroupItem value="self" className="border-orange-500 text-orange-500" />
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border border-orange-500/20 bg-orange-500/10">
                    <Users className="h-6 w-6 text-orange-500/50" />
                  </span>
                  <span>
                    <span className="block text-sm text-white/60">Host as yourself</span>
                    <span className="block font-bold text-white">{session?.user?.name || "Buddy"}</span>
                  </span>
                </label>

                {areBusinessesLoading && (
                  <div className="h-20 animate-pulse rounded-2xl border border-white/5 bg-background/30" />
                )}
                {businessesLoadFailed && (
                  <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    Your Business Pages could not be loaded. You can still host this event as yourself.
                  </p>
                )}
                {(managedBusinesses ?? []).filter((business) => business.isPublished).map((business) => (
                  <label
                    key={business.id}
                    className="flex cursor-pointer items-center gap-4 rounded-2xl border border-[#D6B56D]/20 bg-background/50 p-4 transition-colors has-[[data-state=checked]]:border-[#D6B56D]/60 has-[[data-state=checked]]:bg-[#D6B56D]/5"
                    data-testid={`meetup-event-host-business-${business.id}`}
                  >
                    <RadioGroupItem value={String(business.id)} className="border-[#D6B56D] text-[#D6B56D]" />
                    <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-[#D6B56D]/20 bg-[#D6B56D]/10">
                      {business.logoUrl ? (
                        <img src={business.logoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Store className="h-6 w-6 text-[#D6B56D]/70" />
                      )}
                    </span>
                    <span>
                      <span className="block text-sm text-white/60">Host as a Business Page</span>
                      <span className="block font-bold text-white">{business.name}</span>
                      <span className="block text-xs text-[#D6B56D]">@{business.handle}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">Event Details</h2>
              
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Event Title *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Friday Night Tangiers Session" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500 text-lg py-6" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                <FormField
                  control={form.control}
                  name="startsAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Start Time *</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="endsAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">End Time (Optional)</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="eventCategory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Category</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Lounge Meetup, House Session, Virtual Smoke" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Description</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="What are we smoking? What should people bring?" 
                        className="bg-background/80 border-orange-500/10 min-h-[120px] focus-visible:ring-orange-500" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-4 pt-4 border-t border-orange-500/10">
                <label className="text-sm font-medium text-white">Event Image (Optional)</label>
                <div className="space-y-4">
                  {coverFile ? (
                    <div className="h-40 w-full rounded-2xl bg-background/50 border border-orange-500/30 overflow-hidden relative group">
                      <img src={URL.createObjectURL(coverFile)} className="w-full h-full object-cover" alt="Cover preview" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button variant="outline" type="button" onClick={() => setCoverFile(null)} className="border-white/20 text-white">Remove Photo</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-24 w-full rounded-xl border-2 border-dashed border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10 transition-colors flex items-center justify-center cursor-pointer gap-3" onClick={() => document.getElementById('event-cover-upload')?.click()}>
                      <ImageIcon className="w-6 h-6 text-orange-500/50" />
                      <span className="text-sm text-orange-400 font-medium">Add an image</span>
                    </div>
                  )}
                  <Input 
                    id="event-cover-upload"
                    type="file" 
                    accept="image/*" 
                    onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </div>
              </div>
            </div>

            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">Location & Attendance</h2>
              
              <FormField
                control={form.control}
                name="eventFormat"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="grid grid-cols-1 md:grid-cols-3 gap-4"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0 rounded-xl border border-orange-500/20 p-4 bg-background/50 [&:has([data-state=checked])]:border-orange-500/60 [&:has([data-state=checked])]:bg-orange-500/5 transition-colors cursor-pointer">
                          <FormControl>
                            <RadioGroupItem value="in_person" className="text-orange-500 border-orange-500" />
                          </FormControl>
                          <FormLabel className="text-white font-medium flex items-center gap-2 cursor-pointer w-full">
                            <MapPin className="w-4 h-4 text-orange-400" /> In Person
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0 rounded-xl border border-orange-500/20 p-4 bg-background/50 [&:has([data-state=checked])]:border-orange-500/60 [&:has([data-state=checked])]:bg-orange-500/5 transition-colors cursor-pointer">
                          <FormControl>
                            <RadioGroupItem value="online" className="text-orange-500 border-orange-500" />
                          </FormControl>
                          <FormLabel className="text-white font-medium flex items-center gap-2 cursor-pointer w-full">
                            <LinkIcon className="w-4 h-4 text-orange-400" /> Online
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0 rounded-xl border border-orange-500/20 p-4 bg-background/50 [&:has([data-state=checked])]:border-orange-500/60 [&:has([data-state=checked])]:bg-orange-500/5 transition-colors cursor-pointer">
                          <FormControl>
                            <RadioGroupItem value="hybrid" className="text-orange-500 border-orange-500" />
                          </FormControl>
                          <FormLabel className="text-white font-medium flex items-center gap-2 cursor-pointer w-full">
                            <SwitchCamera className="w-4 h-4 text-orange-400" /> Hybrid
                          </FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                  </FormItem>
                )}
              />

              {["in_person", "hybrid"].includes(eventFormat) && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 p-4 border border-orange-500/10 rounded-xl bg-background/30">
                  <h3 className="text-orange-400 text-sm font-bold uppercase tracking-wider">Physical Location</h3>
                  <FormField
                    control={form.control}
                    name="venueName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white">Venue Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Oasis Hookah Lounge" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white">Address</FormLabel>
                        <FormControl>
                          <Input placeholder="123 Lounge St" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex gap-4">
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormLabel className="text-white">City *</FormLabel>
                          <FormControl>
                            <Input placeholder="Las Vegas" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="state"
                      render={({ field }) => (
                        <FormItem className="w-[100px]">
                          <FormLabel className="text-white">State *</FormLabel>
                          <FormControl>
                            <Input placeholder="NV" maxLength={2} className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500 uppercase" {...field} onChange={e => field.onChange(e.target.value.toUpperCase())} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="howToFind"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white">How to find us</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Look for the group with the orange tent banner" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {["online", "hybrid"].includes(eventFormat) && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 p-4 border border-orange-500/10 rounded-xl bg-background/30">
                  <h3 className="text-orange-400 text-sm font-bold uppercase tracking-wider">Online Link</h3>
                  <FormField
                    control={form.control}
                    name="onlineUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white">Meeting Link *</FormLabel>
                        <FormControl>
                          <Input placeholder="https://zoom.us/..." type="url" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="onlineUrlProtected"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 mt-2">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} className="border-orange-500/40 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500" />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="text-white">Protect Link</FormLabel>
                          <FormDescription>Only show this link to confirmed RSVPs.</FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-orange-500/10 mt-6">
                <FormField
                  control={form.control}
                  name="attendeeLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Attendee Limit</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" placeholder="0 = unlimited" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                      </FormControl>
                      <FormDescription>Leave at 0 for no limit.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="waitlistEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-orange-500/10 p-4 bg-background/50 h-full mt-auto">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} className="border-orange-500/40 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500 mt-1" />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-white">Enable Waitlist</FormLabel>
                        <FormDescription>Allow members to waitlist if the limit is reached.</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-orange-500/10 mt-6">
                <FormField
                  control={form.control}
                  name="allowGuests"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-orange-500/10 p-4 bg-background/50">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} className="border-orange-500/40 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500 mt-1" />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-white">Allow Guests</FormLabel>
                        <FormDescription>Members can bring +1s.</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                {allowGuests && (
                  <FormField
                    control={form.control}
                    name="maxGuestsPerRsvp"
                    render={({ field }) => (
                      <FormItem className="animate-in fade-in">
                        <FormLabel className="text-white">Max Guests Per RSVP</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" max="10" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </div>
            
            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">Privacy & Payment</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="visibility"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Event Visibility *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-background/80 border-orange-500/10 focus:ring-orange-500">
                            <SelectValue placeholder="Select visibility" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-card border-orange-500/20">
                          <SelectItem value="public">Public</SelectItem>
                          <SelectItem value="private">Group Members Only</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="hideAttendees"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-orange-500/10 p-4 bg-background/50 mt-8">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="border-orange-500/40 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-white">Hide Attendees</FormLabel>
                        <FormDescription>Don't show the RSVP list to regular members.</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <div className="pt-4 border-t border-orange-500/10">
                <FormField
                  control={form.control}
                  name="isPaid"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel className="text-white">Is this a free or paid event?</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={(val) => field.onChange(val === "paid")}
                          defaultValue={field.value ? "paid" : "free"}
                          className="flex gap-4"
                        >
                          <FormItem className="flex items-center space-x-2">
                            <FormControl>
                              <RadioGroupItem value="free" className="text-orange-500 border-orange-500" />
                            </FormControl>
                            <FormLabel className="text-white cursor-pointer font-normal">Free / BYOB</FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-2">
                            <FormControl>
                              <RadioGroupItem value="paid" className="text-orange-500 border-orange-500" />
                            </FormControl>
                            <FormLabel className="text-white cursor-pointer font-normal">Paid / Cover Charge</FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                    </FormItem>
                  )}
                />

                {isPaid && (
                  <div className="mt-4 p-4 border border-orange-500/30 bg-orange-500/10 rounded-xl flex items-start gap-3 animate-in fade-in">
                    <Info className="w-5 h-5 text-orange-400 mt-0.5 shrink-0" />
                    <div>
                      <h4 className="text-orange-400 font-bold mb-1">Paid Events Support Coming Soon</h4>
                      <p className="text-white/70 text-sm">
                        Checkout is not yet available. RSVPs will be disabled for this event, and users will see that it is a paid event but cannot confirm payment yet.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="pt-4 border-t border-orange-500/10">
                <FormField
                  control={form.control}
                  name="communityConfirmation"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-orange-500/20 p-4 bg-orange-500/5">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="border-orange-500/40 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-white font-bold">Community Confirmation *</FormLabel>
                        <FormDescription className="text-white/70">I agree to host a safe, responsible event and ensure it complies with local laws.</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

            </div>

            <div className="flex justify-end pt-4 pb-20">
              <Button 
                type="submit" 
                size="lg" 
                disabled={createEvent.isPending || isUploading}
                className="rounded-full bg-orange-600 hover:bg-orange-500 text-white font-bold px-12 h-14 text-lg w-full md:w-auto shadow-[0_0_20px_rgba(249,115,22,0.4)]"
              >
                {isUploading ? "Uploading..." : createEvent.isPending ? "Scheduling..." : "Schedule Event"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </Layout>
  );
}
