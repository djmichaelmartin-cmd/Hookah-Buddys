import { useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { useCreateGroup, useGetCurrentUser, useCreateGroupRule } from "@workspace/api-client-react";
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
import { CalendarDays, Globe, Lock, MapPin, Tent } from "lucide-react";
import { uploadImage } from "@/lib/uploadImage";
import { getErrorMessage } from "@/lib/error";

const createMeetupSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().min(10, "Please describe the meetup").max(2000),
  city: z.string().min(1, "City is required").max(100),
  state: z.string().length(2, "State must be 2 letters (e.g. NV)").toUpperCase(),
  mainInterest: z.string().min(1, "Main interest is required").max(50),
  tags: z.string().min(1, "At least one tag is required"),
  privacy: z.enum(["public", "private"]),
  visibility: z.enum(["visible", "hidden"]),
  agreed: z.boolean().refine(val => val === true, "You must agree to the group moderation standards"),
  agreedRules: z.boolean().refine(val => val === true, "You must agree to the platform rules"),
});

type CreateMeetupForm = z.infer<typeof createMeetupSchema>;

export default function MeetupCreate() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { data: session, isLoading: isSessionLoading } = useGetCurrentUser();

  const createGroup = useCreateGroup();
  const createRule = useCreateGroupRule();

  const form = useForm<CreateMeetupForm>({
    resolver: zodResolver(createMeetupSchema),
    defaultValues: {
      name: "",
      description: "",
      city: "",
      state: "",
      mainInterest: "",
      tags: "",
      privacy: "public",
      visibility: "visible",
      agreed: false,
      agreedRules: false,
    }
  });

  if (isSessionLoading) return <Layout><div className="min-h-screen animate-pulse bg-background" /></Layout>;

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

  const onSubmit = async (data: CreateMeetupForm) => {
    if (!coverFile) {
      toast({ title: "Cover photo required", description: "Meetups look better with a banner image.", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const coverUrl = await uploadImage(coverFile);
      const tagsArray = data.tags.split(',').map(t => t.trim()).filter(Boolean);
      
      const group = await createGroup.mutateAsync({
        data: {
          name: data.name,
          description: data.description,
          category: "events", // Sensible category fallback for old clients
          groupType: "meetup", // Use new discriminator
          tags: tagsArray.length > 0 ? tagsArray : undefined,
          privacy: data.privacy,
          visibility: data.visibility,
          meetupCity: data.city,
          meetupState: data.state,
          meetupCountry: "US",
          location: `${data.city}, ${data.state}`,
          meetupInterests: [data.mainInterest],
          postingPermission: "all_members",
          postApproval: false,
          coverUrl,
        }
      });

      const groupId = group.id;

      // Automatically set some standard meetup rules
      await createRule.mutateAsync({ groupId, data: { title: "Respect the space and each other" } });
      await createRule.mutateAsync({ groupId, data: { title: "RSVP honestly — update if your plans change" } });
      
      toast({ title: "Meetup group created!" });
      setLocation(`/meetups/${groupId}`);
      
    } catch (err: unknown) {
      toast({ title: "Failed to create meetup", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

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
          <p className="text-white/70 text-lg ml-[4.5rem]">Gather local buddies, share a session, and build your community.</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">Meetup Details</h2>
              
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Meetup Group Name *</FormLabel>
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
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">City *</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-500/60" />
                          <Input placeholder="Las Vegas" className="pl-9 bg-background/80 border-orange-500/10 focus-visible:ring-orange-500" {...field} />
                        </div>
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
                      <FormLabel className="text-white">State (2 letters) *</FormLabel>
                      <FormControl>
                        <Input placeholder="NV" maxLength={2} className="bg-background/80 border-orange-500/10 focus-visible:ring-orange-500 uppercase" {...field} onChange={e => field.onChange(e.target.value.toUpperCase())} />
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
                    <FormItem>
                      <FormLabel className="text-white">Other Tags (comma separated) *</FormLabel>
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
                    <FormLabel className="text-white">Description *</FormLabel>
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
                  {coverFile ? (
                    <div className="h-40 w-full rounded-2xl bg-background/50 border border-orange-500/30 overflow-hidden relative group">
                      <img src={URL.createObjectURL(coverFile)} className="w-full h-full object-cover" alt="Cover preview" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button variant="outline" type="button" onClick={() => setCoverFile(null)} className="border-white/20 text-white">Change Photo</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-40 w-full rounded-2xl border-2 border-dashed border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10 transition-colors flex flex-col items-center justify-center cursor-pointer" onClick={() => document.getElementById('cover-upload')?.click()}>
                      <CalendarDays className="w-8 h-8 text-orange-500/50 mb-2" />
                      <p className="text-sm text-orange-400 font-medium">Click to upload a banner image</p>
                      <p className="text-xs text-orange-500/60 mt-1">Recommended: 1200x400px</p>
                    </div>
                  )}
                  <Input 
                    id="cover-upload"
                    type="file" 
                    accept="image/*" 
                    onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </div>
              </div>
            </div>

            <div className="bg-card/60 backdrop-blur-md border border-orange-500/20 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <h2 className="text-xl font-serif text-orange-400">Settings</h2>
              
              <FormField
                control={form.control}
                name="privacy"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel className="text-white">Privacy Level *</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="grid grid-cols-1 md:grid-cols-2 gap-4"
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

              <FormField
                control={form.control}
                name="visibility"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Search Visibility *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-background/80 border-orange-500/10 focus:ring-orange-500">
                          <SelectValue placeholder="Select visibility" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-card border-orange-500/20">
                        <SelectItem value="visible">Visible (Shows in search)</SelectItem>
                        <SelectItem value="hidden">Hidden (Invite only)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>Visible meetups can be found by anyone.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="pt-4 border-t border-orange-500/10 space-y-4">
                <FormField
                  control={form.control}
                  name="agreed"
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
                        <FormDescription className="text-white/70">I agree to host safe, responsible meetups and follow the moderation standards.</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="agreedRules"
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
                        <FormLabel className="text-white font-bold">I agree to the Platform Rules *</FormLabel>
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
                disabled={createGroup.isPending || isUploading}
                className="rounded-full bg-orange-600 hover:bg-orange-500 text-white font-bold px-12 h-14 text-lg w-full md:w-auto shadow-[0_0_20px_rgba(249,115,22,0.4)]"
              >
                {isUploading ? "Uploading..." : createGroup.isPending ? "Creating Meetup..." : "Start Meetup"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </Layout>
  );
}
