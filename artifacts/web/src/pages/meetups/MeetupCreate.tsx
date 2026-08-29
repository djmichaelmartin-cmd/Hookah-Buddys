import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Layout } from "@/components/Layout";
import {
  getGetMeetupDraftQueryKey,
  useCreateMeetup,
  useCreateMeetupDraft,
  useGetCurrentUser,
  useGetMeetupDraft,
  useListEditableReelBusinesses,
  useListFriends,
  useListFollows,
  useListLounges,
  useUpdateMeetupDraft,
  getListEditableReelBusinessesQueryKey,
  getListFriendsQueryKey,
  getListFollowsQueryKey,
  type MeetupDraftInput,
} from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { uploadImage } from "@/lib/uploadImage";
import { getErrorMessage } from "@/lib/error";
import { CalendarDays, Globe, Lock, MapPin, Tent, Image as ImageIcon, Link as LinkIcon, SwitchCamera, Store, Users } from "lucide-react";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { meetupHostType, trackEvent } from "@/lib/analytics";

const createMeetupCombinedSchema = z.object({
  // Meetup fields
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().min(10, "Please describe the meetup").max(2000),
  category: z.string().default("Hookah"),
  mainInterest: z.string().min(1, "Main interest is required").max(50),
  tags: z.string().optional(),
  privacy: z.enum(["public", "private"]),
  visibility: z.enum(["visible", "hidden"]),

  // Event fields
  title: z.string().min(1, "Event title is required").max(100),
  eventDescription: z.string().max(2000).optional(),
  eventFormat: z.enum(["in_person", "online", "hybrid"]),
  startsAt: z.string().min(1, "Start time is required"),
  endsAt: z.string().min(1, "End time is required"),

  // Location
  venueName: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),

  // Online
  onlineUrl: z.string().optional().or(z.literal("")),
  instructions: z.string().optional(),
  howToFind: z.string().optional(),
  rulesNotes: z.string().optional(),

  // Attendance
  hideAttendees: z.boolean().default(false),
  attendeeLimit: z.coerce.number().min(0).optional().or(z.literal(0)),
  waitlistEnabled: z.boolean().default(false),
  allowGuests: z.boolean().default(false),
  maxGuestsPerRsvp: z.coerce.number().min(1).optional(),

  rsvpClosesAt: z.string().optional(),

  // Payment
  isPaid: z.boolean().default(false),
  ticketPrice: z.string().optional(),
  refundPolicy: z.string().optional(),

  // Confirmation
  communityConfirmation: z.boolean().refine(val => val === true, "You must confirm to proceed"),
}).superRefine((data, ctx) => {
  if (data.startsAt && data.endsAt) {
    const startsAt = new Date(data.startsAt);
    const endsAt = new Date(data.endsAt);
    if (Number.isNaN(startsAt.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startsAt"],
        message: "Start time must be a valid date",
      });
    }
    if (Number.isNaN(endsAt.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End time must be a valid date",
      });
    } else if (!Number.isNaN(startsAt.getTime()) && endsAt <= startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End time must be after start time",
      });
    }
  }

  if (["in_person", "hybrid"].includes(data.eventFormat)) {
    const requiredLocationFields: Array<[
      "venueName" | "address" | "city" | "state",
      string,
    ]> = [
      ["venueName", "Venue name is required for physical events"],
      ["address", "Address is required for physical events"],
      ["city", "City is required for physical events"],
      ["state", "State is required for physical events"],
    ];
    requiredLocationFields.forEach(([path, message]) => {
      if (!data[path]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
      }
    });
  }
  if (["online", "hybrid"].includes(data.eventFormat)) {
    if (!data.onlineUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["onlineUrl"],
        message: "Meeting link is required for online events",
      });
    } else if (!/^https?:\/\//i.test(data.onlineUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["onlineUrl"],
        message: "Meeting link must start with http:// or https://",
      });
    }
  }

  if (data.rsvpClosesAt) {
    const rsvpClosesAt = new Date(data.rsvpClosesAt);
    const startsAt = new Date(data.startsAt);
    if (Number.isNaN(rsvpClosesAt.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rsvpClosesAt"],
        message: "RSVP deadline must be a valid date",
      });
    } else if (!Number.isNaN(startsAt.getTime()) && rsvpClosesAt > startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rsvpClosesAt"],
        message: "RSVP deadline must be before the event starts",
      });
    }
  }

  if (data.isPaid) {
    if (!data.ticketPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ticketPrice"],
        message: "Ticket price is required for paid events",
      });
    }
  }
});

type CreateMeetupCombinedForm = z.infer<typeof createMeetupCombinedSchema>;

export default function MeetupCreate() {
  const [_, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const draftIdParam = new URLSearchParams(search).get("draftId");
  const draftId = draftIdParam && /^\d+$/.test(draftIdParam) ? Number(draftIdParam) : null;

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [eventCoverFile, setEventCoverFile] = useState<File | null>(null);
  const [savedCoverUrl, setSavedCoverUrl] = useState<string | null>(null);
  const [savedEventCoverUrl, setSavedEventCoverUrl] = useState<string | null>(null);
  const [hasImageChanges, setHasImageChanges] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [businessId, setBusinessId] = useState<number | null>(null);
  const { data: session, isLoading: isSessionLoading } = useGetCurrentUser();
  const currentUserId = session?.user?.id ?? 0;
  const { data: buddys = [] } = useListFriends(
    { userId: currentUserId },
    { query: { enabled: currentUserId > 0, queryKey: getListFriendsQueryKey({ userId: currentUserId }) } },
  );
  const { data: followers = [] } = useListFollows(
    { userId: currentUserId, direction: "followers" },
    { query: { enabled: currentUserId > 0, queryKey: getListFollowsQueryKey({ userId: currentUserId, direction: "followers" }) } },
  );
  const { data: lounges = [] } = useListLounges({ limit: 200 });
  const [invitedUserIds, setInvitedUserIds] = useState<number[]>([]);
  const [loungeId, setLoungeId] = useState<number | undefined>();
  const inviteOptions = useMemo(
    () => [...new Map([...buddys, ...followers].map((person) => [person.id, person])).values()],
    [buddys, followers],
  );
  const {
    data: managedBusinesses,
    isLoading: areBusinessesLoading,
    isError: businessesLoadFailed,
  } = useListEditableReelBusinesses(
    undefined,
    {
      query: {
        enabled: !!session?.authenticated,
        queryKey: getListEditableReelBusinessesQueryKey(),
      },
    },
  );

  const createMeetup = useCreateMeetup();
  const createDraft = useCreateMeetupDraft();
  const updateDraft = useUpdateMeetupDraft();
  const { data: draft, isLoading: isDraftLoading } = useGetMeetupDraft(draftId ?? 0, {
    query: {
      queryKey: getGetMeetupDraftQueryKey(draftId ?? 0),
      enabled: draftId !== null,
    },
  });

  const form = useForm<CreateMeetupCombinedForm>({
    resolver: zodResolver(createMeetupCombinedSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "Hookah",
      mainInterest: "",
      tags: "",
      privacy: "public",
      visibility: "visible",
      title: "",
      eventDescription: "",
      eventFormat: "in_person",
      venueName: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      onlineUrl: "",
      instructions: "",
      howToFind: "",
      rulesNotes: "",
      startsAt: "",
      endsAt: "",
      hideAttendees: false,
      attendeeLimit: 0,
      waitlistEnabled: false,
      allowGuests: false,
      maxGuestsPerRsvp: 1,
      rsvpClosesAt: "",
      isPaid: false,
      ticketPrice: "",
      refundPolicy: "",
      communityConfirmation: false,
    }
  });
  const allowNavigation = useUnsavedChangesWarning(form.formState.isDirty || hasImageChanges);

  useEffect(() => {
    if (!draft) return;
    const data = draft.data;
    const toLocalDateTime = (value?: string) => {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
      return local.toISOString().slice(0, 16);
    };
    form.reset({
      name: data.name ?? "",
      description: data.description ?? "",
      category: data.category ?? "Hookah",
      mainInterest: data.interests?.[0] ?? "",
      tags: data.tags?.join(", ") ?? "",
      privacy: data.privacy ?? "public",
      visibility: data.visibility ?? "visible",
      title: data.title ?? "",
      eventDescription: data.eventDescription ?? "",
      eventFormat: data.eventFormat ?? "in_person",
      venueName: data.venueName ?? "",
      address: data.address ?? "",
      city: data.city ?? "",
      state: data.state ?? "",
      zip: data.zip ?? "",
      onlineUrl: data.onlineUrl ?? "",
      instructions: data.instructions ?? "",
      howToFind: data.howToFind ?? "",
      rulesNotes: data.rulesNotes ?? "",
      startsAt: toLocalDateTime(data.startsAt),
      endsAt: toLocalDateTime(data.endsAt),
      hideAttendees: data.hideAttendees ?? false,
      attendeeLimit: data.attendeeLimit ?? 0,
      waitlistEnabled: data.waitlistEnabled ?? false,
      allowGuests: data.allowGuests ?? false,
      maxGuestsPerRsvp: data.maxGuestsPerRsvp ?? 1,
      rsvpClosesAt: toLocalDateTime(data.rsvpClosesAt),
      isPaid: data.isPaid ?? false,
      ticketPrice: typeof data.paidMetadata?.ticketPrice === "string" ? data.paidMetadata.ticketPrice : "",
      refundPolicy: typeof data.paidMetadata?.refundPolicy === "string" ? data.paidMetadata.refundPolicy : "",
      communityConfirmation: false,
    });
    setSavedCoverUrl(data.coverUrl ?? null);
    setSavedEventCoverUrl(data.imageUrl ?? null);
    setHasImageChanges(false);
  }, [draft, form]);

  if (isSessionLoading || (draftId !== null && isDraftLoading)) return <Layout><div className="min-h-screen animate-pulse bg-background" /></Layout>;

  if (!session?.authenticated) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 text-center max-w-lg">
          <div className="bg-card/50 border border-orange-500/20 rounded-3xl p-12 shadow-[0_0_30px_rgba(249,115,22,0.1)]">
            <Tent className="w-16 h-16 text-orange-500 mx-auto mb-6" />
            <h2 className="text-3xl font-serif text-white mb-4">Log in to start a Meetup</h2>
            <p className="text-muted-foreground mb-8">
              Meetups let you coordinate local sessions with other Buddys. Sign in first, then return here.
            </p>
            <Button onClick={() => setLocation("/login")} size="lg" className="bg-orange-600 hover:bg-orange-500 text-white rounded-full">Log In</Button>
          </div>
        </div>
      </Layout>
    );
  }

  const uploadDraftImages = async () => {
    const coverUrl = coverFile ? await uploadImage(coverFile) : savedCoverUrl ?? undefined;
    const imageUrl = eventCoverFile ? await uploadImage(eventCoverFile) : savedEventCoverUrl ?? undefined;
    return { coverUrl, imageUrl };
  };

  const toDraftInput = (
    data: CreateMeetupCombinedForm,
    images: { coverUrl?: string; imageUrl?: string },
  ): MeetupDraftInput => {
    const tagsArray = data.tags ? data.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
    const dateOrUndefined = (value?: string) => {
      if (!value) return undefined;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toISOString();
    };
    return {
      name: data.name || undefined,
      description: data.description || undefined,
      category: data.category || undefined,
      interests: data.mainInterest ? [data.mainInterest] : undefined,
      tags: tagsArray,
      coverUrl: images.coverUrl,
      privacy: data.privacy,
      visibility: data.visibility,
      title: data.title || undefined,
      eventDescription: data.eventDescription || undefined,
      imageUrl: images.imageUrl,
      eventFormat: data.eventFormat,
      startsAt: dateOrUndefined(data.startsAt),
      endsAt: dateOrUndefined(data.endsAt),
      venueName: data.venueName || undefined,
      address: data.address || undefined,
      city: data.city || undefined,
      state: data.state || undefined,
      zip: data.zip || undefined,
      onlineUrl: data.onlineUrl || undefined,
      instructions: data.instructions || undefined,
      howToFind: data.howToFind || undefined,
      rulesNotes: data.rulesNotes || undefined,
      hideAttendees: data.hideAttendees,
      attendeeLimit: data.attendeeLimit && data.attendeeLimit > 0 ? data.attendeeLimit : undefined,
      waitlistEnabled: data.waitlistEnabled,
      allowGuests: data.allowGuests,
      maxGuestsPerRsvp: data.allowGuests ? (data.maxGuestsPerRsvp || 1) : undefined,
      rsvpClosesAt: dateOrUndefined(data.rsvpClosesAt),
      isPaid: data.isPaid,
      paidMetadata: data.isPaid ? {
        provider: "manual",
        ticketPrice: data.ticketPrice,
        refundPolicy: data.refundPolicy,
      } : undefined,
    };
  };

  const saveDraft = async () => {
    setIsUploading(true);
    try {
      const images = await uploadDraftImages();
      const data = toDraftInput(form.getValues(), images);
      const saved = draftId === null
        ? await createDraft.mutateAsync({ data })
        : await updateDraft.mutateAsync({ groupId: draftId, data });
      setSavedCoverUrl(saved.data.coverUrl ?? null);
      setSavedEventCoverUrl(saved.data.imageUrl ?? null);
      setCoverFile(null);
      setEventCoverFile(null);
      form.reset(form.getValues());
      setHasImageChanges(false);
      allowNavigation();
      toast({ title: "Meetup draft saved", description: "You can return from My Meetups anytime." });
      if (draftId === null) setLocation(`/meetups/create?draftId=${saved.group.id}`);
    } catch (err: unknown) {
      toast({ title: "Failed to save draft", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const onSubmit = async (data: CreateMeetupCombinedForm) => {
    if (!coverFile && !savedCoverUrl) {
      toast({ title: "Cover photo required", description: "Meetups look better with a banner image.", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const { coverUrl, imageUrl } = await uploadDraftImages();

      const tagsArray = data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

      const { group } = await createMeetup.mutateAsync({
        data: {
          draftId: draftId ?? undefined,
          name: data.name,
          description: data.description,
          category: data.category,
          interests: [data.mainInterest],
          tags: tagsArray,
          coverUrl,
          privacy: data.privacy,
          visibility: data.visibility,
          ...(businessId ? { businessId } : {}),

          title: data.title,
          eventDescription: data.eventDescription,
          imageUrl,
          eventFormat: data.eventFormat,
          startsAt: new Date(data.startsAt).toISOString(),
          endsAt: new Date(data.endsAt).toISOString(),

          venueName: data.venueName,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
          onlineUrl: ["online", "hybrid"].includes(data.eventFormat) ? data.onlineUrl || undefined : undefined,
          instructions: ["online", "hybrid"].includes(data.eventFormat) ? data.instructions || undefined : undefined,
          howToFind: ["in_person", "hybrid"].includes(data.eventFormat) ? data.howToFind || undefined : undefined,
          rulesNotes: data.rulesNotes,
          eventCategory: data.category,
          topics: [data.mainInterest],
          eventTags: tagsArray,

          hideAttendees: data.hideAttendees,
          attendeeLimit: data.attendeeLimit && data.attendeeLimit > 0 ? data.attendeeLimit : undefined,
          waitlistEnabled: data.waitlistEnabled,
          allowGuests: data.allowGuests,
          maxGuestsPerRsvp: data.allowGuests ? (data.maxGuestsPerRsvp || 1) : undefined,
          rsvpClosesAt: data.rsvpClosesAt ? new Date(data.rsvpClosesAt).toISOString() : undefined,

          isPaid: data.isPaid,
          paidMetadata: data.isPaid ? {
            provider: "manual",
            ticketPrice: data.ticketPrice,
            refundPolicy: data.refundPolicy
          } : undefined,
          invitedUserIds,
          loungeId,
        }
      });

      trackEvent("meetup_published", {
        host_type: meetupHostType(businessId),
        invite_count: invitedUserIds.length,
        has_invites: invitedUserIds.length > 0,
        privacy: data.privacy,
        event_format: data.eventFormat,
        published_from_draft: draftId !== null,
      });
      toast({ title: "Your Meetup has been created." });
      allowNavigation();
      setLocation(`/meetups/${group.id}`);

    } catch (err: unknown) {
      toast({ title: "Failed to create meetup", description: getErrorMessage(err), variant: "destructive" });
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
          <h1 className="font-serif text-4xl text-white font-bold mb-3 flex items-center gap-3 drop-shadow-md">
            <span className="bg-orange-500/20 p-3 rounded-2xl border border-orange-500/40">
              <Tent className="w-8 h-8 text-orange-500" />
            </span>
            Start a Meetup
          </h1>
          <p className="text-white/70 text-lg ml-[4.5rem]">
            Create your Meetup with the event details, date, time, location, RSVP settings, and invite options all in one step.
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-serif text-orange-400">Host & Organizer</h2>
              </div>
              <RadioGroup
                value={businessId == null ? "self" : String(businessId)}
                onValueChange={(value) => setBusinessId(value === "self" ? null : Number(value))}
                className="grid gap-3"
                data-testid="meetup-host-picker"
              >
                <label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-orange-500/20 bg-background/50 p-4 transition-colors has-[[data-state=checked]]:border-orange-500/60 has-[[data-state=checked]]:bg-orange-500/5">
                  <RadioGroupItem value="self" className="border-orange-500 text-orange-500" />
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                    <Users className="w-6 h-6 text-orange-500/50" />
                  </div>
                  <div>
                    <p className="text-sm text-white/60">Host as yourself</p>
                    <p className="text-white font-bold">{session?.user?.name || "Buddy"}</p>
                  </div>
                </label>

                {areBusinessesLoading && (
                  <div className="h-20 animate-pulse rounded-2xl border border-white/5 bg-background/30" />
                )}
                {businessesLoadFailed && (
                  <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    Your Business Pages could not be loaded. You can still host this Meetup as yourself.
                  </p>
                )}
                {(managedBusinesses ?? []).filter((business) => business.isPublished).map((business) => (
                  <label
                    key={business.id}
                    className="flex cursor-pointer items-center gap-4 rounded-2xl border border-[#D6B56D]/20 bg-background/50 p-4 transition-colors has-[[data-state=checked]]:border-[#D6B56D]/60 has-[[data-state=checked]]:bg-[#D6B56D]/5"
                    data-testid={`meetup-host-business-${business.id}`}
                  >
                    <RadioGroupItem value={String(business.id)} className="border-[#D6B56D] text-[#D6B56D]" />
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-[#D6B56D]/10 border border-[#D6B56D]/20 flex items-center justify-center">
                      {business.logoUrl ? (
                        <img src={business.logoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Store className="w-6 h-6 text-[#D6B56D]/70" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm text-white/60">Host as a Business Page</p>
                      <p className="text-white font-bold">{business.name}</p>
                      <p className="text-xs text-[#D6B56D]">@{business.handle}</p>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">Meetup Group Info</h2>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Meetup Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Vegas Weekend Smokes" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Category *</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          className="flex h-9 w-full rounded-md border border-orange-500/10 bg-background/80 px-3 py-2 text-sm text-white shadow-sm outline-none focus:ring-1 focus:ring-orange-500"
                        >
                          <option value="Hookah">Hookah</option>
                          <option value="Food">Food</option>
                          <option value="Music">Music</option>
                          <option value="Business">Business</option>
                          <option value="Nightlife">Nightlife</option>
                          <option value="Outdoors">Outdoors</option>
                          <option value="Other">Other</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="mainInterest"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Main Interest *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Dark Leaf Tobacco" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tags"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel className="text-white">Tags (comma separated)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. tangiers, lounge-hops" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Meetup Description *</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="What is this meetup group about? What kind of vibe are you looking for?"
                        className="bg-background/80 border-orange-500/10 min-h-[120px] focus-visible:ring-orange-500"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-4 pt-4 border-t border-orange-500/10">
                <label className="text-sm font-medium text-white">Cover Photo *</label>
                <div className="space-y-4">
                  {coverFile || savedCoverUrl ? (
                    <div className="h-40 w-full rounded-2xl bg-background/50 border border-orange-500/30 overflow-hidden relative group">
                      <img src={coverFile ? URL.createObjectURL(coverFile) : savedCoverUrl ?? ""} className="w-full h-full object-cover" alt="Cover preview" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button variant="outline" type="button" onClick={() => { setCoverFile(null); setSavedCoverUrl(null); setHasImageChanges(true); }} className="border-white/20 text-white">Change Photo</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-40 w-full rounded-2xl border-2 border-dashed border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10 transition-colors flex flex-col items-center justify-center cursor-pointer" onClick={() => document.getElementById('cover-upload')?.click()}>
                      <CalendarDays className="w-8 h-8 text-orange-500/50 mb-2" />
                      <p className="text-sm text-orange-400 font-medium">Click to upload a banner image</p>
                      <p className="text-xs text-orange-500/60 mt-1">Required</p>
                    </div>
                  )}
                  <Input
                    id="cover-upload"
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      setCoverFile(e.target.files?.[0] || null);
                      if (e.target.files?.[0]) setHasImageChanges(true);
                    }}
                    className="hidden"
                  />
                </div>
              </div>
            </div>

            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">Primary Event Details</h2>

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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                      <FormLabel className="text-white">End Time *</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <p className="text-sm text-white/60 -mt-2">
                Time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </p>

              <FormField
                control={form.control}
                name="eventDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Event Description</FormLabel>
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
                  {eventCoverFile || savedEventCoverUrl ? (
                    <div className="h-40 w-full rounded-2xl bg-background/50 border border-orange-500/30 overflow-hidden relative group">
                      <img src={eventCoverFile ? URL.createObjectURL(eventCoverFile) : savedEventCoverUrl ?? ""} className="w-full h-full object-cover" alt="Event cover preview" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button variant="outline" type="button" onClick={() => { setEventCoverFile(null); setSavedEventCoverUrl(null); setHasImageChanges(true); }} className="border-white/20 text-white">Remove Photo</Button>
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
                    onChange={(e) => {
                      setEventCoverFile(e.target.files?.[0] || null);
                      if (e.target.files?.[0]) setHasImageChanges(true);
                    }}
                    className="hidden"
                  />
                </div>
              </div>
            </div>

            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">Location & Format</h2>

              <FormField
                control={form.control}
                name="eventFormat"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
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
                        <FormLabel className="text-white">Venue Name *</FormLabel>
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
                        <FormLabel className="text-white">Address *</FormLabel>
                        <FormControl>
                          <Input placeholder="123 Lounge St" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem className="col-span-2">
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
                        <FormItem>
                          <FormLabel className="text-white">State *</FormLabel>
                          <FormControl>
                            <Input placeholder="NV" maxLength={2} className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500 uppercase" {...field} onChange={e => field.onChange(e.target.value.toUpperCase())} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="zip"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white">ZIP (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="89109" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
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
                  <h3 className="text-orange-400 text-sm font-bold uppercase tracking-wider">Online Details</h3>
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
                    name="instructions"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white">Connection Instructions</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Password is 'hookah'" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">RSVP & Capacity Settings</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                  name="rsvpClosesAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">RSVP Deadline (Optional)</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                      </FormControl>
                      <FormDescription>When do RSVPs close?</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="waitlistEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-orange-500/10 p-4 bg-background/50 h-full">
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

                <div className="space-y-4">
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
                        <FormItem className="animate-in fade-in pl-2">
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
            </div>

            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">Privacy & Payment</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="privacy"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel className="text-white">Privacy Level *</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          value={field.value}
                          className="flex flex-col space-y-2"
                        >
                          <FormItem className="flex items-start space-x-3 space-y-0 rounded-xl border border-orange-500/20 p-4 bg-background/50 [&:has([data-state=checked])]:border-orange-500/60 [&:has([data-state=checked])]:bg-orange-500/5 transition-colors">
                            <FormControl>
                              <RadioGroupItem value="public" className="mt-1 text-orange-500 border-orange-500" />
                            </FormControl>
                            <div className="space-y-1">
                              <FormLabel className="text-white font-medium flex items-center gap-2">
                                <Globe className="w-4 h-4 text-orange-400" /> Public Meetup
                              </FormLabel>
                              <FormDescription className="text-white/60">
                                Anyone can see events and RSVP.
                              </FormDescription>
                            </div>
                          </FormItem>
                          <FormItem className="flex items-start space-x-3 space-y-0 rounded-xl border border-orange-500/20 p-4 bg-background/50 [&:has([data-state=checked])]:border-orange-500/60 [&:has([data-state=checked])]:bg-orange-500/5 transition-colors">
                            <FormControl>
                              <RadioGroupItem value="private" className="mt-1 text-orange-500 border-orange-500" />
                            </FormControl>
                            <div className="space-y-1">
                              <FormLabel className="text-white font-medium flex items-center gap-2">
                                <Lock className="w-4 h-4 text-orange-400" /> Private (Invite)
                              </FormLabel>
                              <FormDescription className="text-white/60">
                                Requires approval. Only members see events.
                              </FormDescription>
                            </div>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-6">
                  <FormField
                    control={form.control}
                    name="visibility"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white">Search Visibility *</FormLabel>
                        <FormControl>
                          <select
                            {...field}
                            className="flex h-9 w-full rounded-md border border-orange-500/10 bg-background/80 px-3 py-2 text-sm text-white shadow-sm outline-none focus:ring-1 focus:ring-orange-500"
                          >
                            <option value="visible">Visible (Shows in search)</option>
                            <option value="hidden">Hidden (Invite only)</option>
                          </select>
                        </FormControl>
                        <FormDescription>Visible meetups can be found by anyone.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="hideAttendees"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-orange-500/10 p-4 bg-background/50">
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
              </div>

              <div className="pt-6 border-t border-orange-500/10">
                <FormField
                  control={form.control}
                  name="isPaid"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel className="text-white">Is this a free or paid event?</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={(val) => field.onChange(val === "paid")}
                          value={field.value ? "paid" : "free"}
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
                  <div className="mt-6 space-y-4 animate-in fade-in slide-in-from-top-2 p-4 border border-orange-500/10 rounded-xl bg-background/30">
                    <FormField
                      control={form.control}
                      name="ticketPrice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white">Ticket Price / Cover Amount *</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. $10 or $25" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="refundPolicy"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white">Refund Policy</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. No refunds within 48 hours" className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">Review & Publish</h2>

              <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 flex gap-3">
                <Users className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-orange-400 font-medium">Inviting Members</p>
                  <p className="text-white/70 text-sm">Once published, you will be able to share direct invite links and notify your connections immediately from the Meetup page.</p>
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium text-white">Invite Buddys &amp; Followers (optional)</p>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-orange-500/20 p-3">
                  {inviteOptions.map((person) => (
                    <label key={person.id} className="flex items-center gap-3 text-sm text-white">
                      <Checkbox
                        checked={invitedUserIds.includes(person.id)}
                        onCheckedChange={(checked) => setInvitedUserIds((ids) =>
                          checked ? [...ids, person.id] : ids.filter((id) => id !== person.id),
                        )}
                      />
                      {person.name}
                    </label>
                  ))}
                  {!inviteOptions.length && <p className="text-sm text-white/60">No Buddys or followers available.</p>}
                </div>
              </div>
              {["in_person", "hybrid"].includes(eventFormat) && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-white">Lounge (optional)</p>
                  <Select
                    value={loungeId?.toString() ?? "none"}
                    onValueChange={(value) => {
                      const lounge = lounges.find((item) => item.id === Number(value));
                      setLoungeId(value === "none" ? undefined : Number(value));
                      if (lounge) {
                        form.setValue("venueName", lounge.name);
                        form.setValue("address", lounge.address ?? "");
                        form.setValue("city", lounge.city);
                        form.setValue("state", lounge.state);
                        form.setValue("zip", lounge.zip ?? "");
                      }
                    }}
                  >
                    <SelectTrigger className="border-orange-500/10 bg-background/80">
                      <SelectValue placeholder="Select a directory Lounge" />
                    </SelectTrigger>
                    <SelectContent className="border-orange-500/20 bg-card">
                      <SelectItem value="none">No Lounge selected</SelectItem>
                      {lounges.map((lounge) => (
                        <SelectItem key={lounge.id} value={lounge.id.toString()}>
                          {lounge.name} — {lounge.city}, {lounge.state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    Selecting a directory Lounge copies its venue details; it does not create a durable Lounge link.
                  </p>
                </div>
              )}

              <FormField
                control={form.control}
                name="rulesNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">House Rules & Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Any specific rules for this meetup? (e.g. Clean up your own coals, BYOB policies)"
                        className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="pt-4 border-t border-orange-500/10">
                <FormField
                  control={form.control}
                  name="communityConfirmation"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-xl border border-orange-500/20 p-5 bg-orange-500/5 transition-colors hover:bg-orange-500/10">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="border-orange-500/40 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500 mt-0.5"
                        />
                      </FormControl>
                      <div className="space-y-1.5 leading-none">
                        <FormLabel className="text-white font-bold text-base cursor-pointer">Community Confirmation *</FormLabel>
                        <FormDescription className="text-white/70 text-sm">I confirm this Meetup is appropriate for the HookahBuddys community.</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="flex flex-col-reverse md:flex-row justify-end gap-3 pt-4 pb-20">
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={saveDraft}
                disabled={createDraft.isPending || updateDraft.isPending || createMeetup.isPending || isUploading}
                className="rounded-full border-orange-500/40 text-orange-300 hover:bg-orange-500/10 font-bold px-10 h-14 text-lg w-full md:w-auto"
              >
                {createDraft.isPending || updateDraft.isPending ? "Saving..." : "Save Draft"}
              </Button>
              <Button
                type="submit"
                size="lg"
                disabled={createDraft.isPending || updateDraft.isPending || createMeetup.isPending || isUploading}
                className="rounded-full bg-orange-600 hover:bg-orange-500 text-white font-bold px-12 h-14 text-lg w-full md:w-auto shadow-[0_0_20px_rgba(249,115,22,0.4)]"
              >
                {isUploading ? "Uploading..." : createMeetup.isPending ? "Publishing..." : "Publish Meetup"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </Layout>
  );
}
