import { useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { useCreateGroup, useGetCurrentUser, useCreateGroupRule, useSetGroupQuestions, useInviteToGroup } from "@workspace/api-client-react";
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
import { Users, Lock, Globe, Image as ImageIcon, MapPin, Search } from "lucide-react";
import { uploadImage } from "@/lib/uploadImage";
import { getErrorMessage } from "@/lib/error";

const createGroupSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  handle: z.string().max(30).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().optional(),
  customCategory: z.string().optional(),
  tags: z.string().optional(),
  privacy: z.enum(["public", "private"]),
  visibility: z.enum(["visible", "hidden"]),
  location: z.string().max(200).optional(),
  postingPermission: z.enum(["all_members", "admins_only"]).optional(),
  postApproval: z.boolean().default(false),
  agreed: z.boolean().refine(val => val === true, "You must agree to the group moderation standards"),
  agreedRules: z.boolean().refine(val => val === true, "You must agree to the platform rules"),
  initialInvites: z.string().optional(),
  rules: z.string().optional(),
  questions: z.string().optional(),
});

type CreateGroupForm = z.infer<typeof createGroupSchema>;

export default function GroupCreate() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { data: session, isLoading: isSessionLoading } = useGetCurrentUser();

  const createGroup = useCreateGroup();
  const createRule = useCreateGroupRule();
  const setQuestions = useSetGroupQuestions();
  const inviteToGroup = useInviteToGroup();

  const form = useForm<CreateGroupForm>({
    resolver: zodResolver(createGroupSchema),
    defaultValues: {
      name: "",
      handle: "",
      description: "",
      category: "discussion",
      privacy: "public",
      visibility: "visible",
      location: "",
      tags: "",
      postingPermission: "all_members",
      postApproval: false,
      agreed: false,
      agreedRules: false,
      initialInvites: "",
      customCategory: "",
      rules: "",
      questions: "",
    }
  });

  if (isSessionLoading) return <Layout><div className="min-h-screen animate-pulse bg-background" /></Layout>;

  if (!session?.authenticated) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 text-center max-w-lg">
          <div className="bg-card/50 border border-white/5 rounded-3xl p-12">
            <Users className="w-16 h-16 text-primary mx-auto mb-6" />
            <h2 className="text-3xl font-serif text-white mb-4">Log in to create a group</h2>
            <p className="text-muted-foreground mb-8">
              Groups are spaces for members. Sign in first, then return here to start your own group.
            </p>
            <Button onClick={() => setLocation("/login")} size="lg">Log In</Button>
          </div>
        </div>
      </Layout>
    );
  }

  const onSubmit = async (data: CreateGroupForm) => {
    setIsUploading(true);
    try {
      let iconUrl;
      let coverUrl;
      
      if (iconFile) {
        iconUrl = await uploadImage(iconFile);
      }
      if (coverFile) {
        coverUrl = await uploadImage(coverFile);
      }

      const tagsArray = data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

      const group = await createGroup.mutateAsync({
        data: {
          name: data.name,
          handle: data.handle || undefined,
          description: data.description || undefined,
          category: data.category || undefined,
          customCategory: data.customCategory || undefined,
          tags: tagsArray.length > 0 ? tagsArray : undefined,
          privacy: data.privacy,
          visibility: data.visibility,
          location: data.location || undefined,
          postingPermission: data.postingPermission,
          postApproval: data.postApproval,
          iconUrl,
          coverUrl,
        }
      });

      // Orchestrate child resources
      let hasWarnings = false;
      const groupId = group.id;

      if (data.rules) {
        const rulesList = data.rules.split('\n').map(r => r.trim()).filter(Boolean);
        for (const r of rulesList) {
          try {
            await createRule.mutateAsync({ groupId, data: { title: r } });
          } catch (e) {
            hasWarnings = true;
          }
        }
      }

      
      if (data.questions) {
        const qsList = data.questions.split('\\n').map(q => q.trim()).filter(Boolean);
        if (qsList.length > 0) {
          try {
            await setQuestions.mutateAsync({ groupId, data: { questions: qsList.map(q => ({ questionText: q, isRequired: true })) } });
          } catch (e) {
            hasWarnings = true;
          }
        }
      }

      if (data.initialInvites) {
        const invites = data.initialInvites.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        for (const userId of invites) {
          try {
            await inviteToGroup.mutateAsync({ groupId, data: { invitedUserId: userId } });
          } catch (e) {
            hasWarnings = true;
          }
        }
      }

      if (hasWarnings) {
        toast({ title: "Group created with warnings", description: "The group was created, but some rules, questions, or invites failed." });
      } else {
        toast({ title: "Group created!" });
      }

      setLocation(`/groups/${groupId}`);
      
    } catch (err: unknown) {
      toast({ title: "Failed to create group", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="font-serif text-4xl text-white font-bold mb-3 flex items-center gap-3">
            <Users className="w-8 h-8 text-primary" /> Create a Group
          </h1>
          <p className="text-white/70 text-lg">Build a space around a topic, location, or shared interest.</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="bg-card/40 border border-white/5 rounded-3xl p-6 md:p-8 space-y-6">
              <h2 className="text-xl font-serif text-white">Basic Info</h2>
              
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Group Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. SF Hookah Aficionados" className="bg-background/50 border-white/10" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="handle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Group Handle (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="sf-hookah" className="bg-background/50 border-white/10" {...field} />
                    </FormControl>
                    <FormDescription>Must be unique. Example: g/sf-hookah</FormDescription>
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
                        placeholder="What is this group about?" 
                        className="bg-background/50 border-white/10 min-h-[100px]" 
                        {...field} 
                      />
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
                      <FormLabel className="text-white">Category</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-background/50 border-white/10">
                            <SelectValue placeholder="Select a category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-card border-white/10">
                          <SelectItem value="discussion">Discussion</SelectItem>
                          <SelectItem value="lounges">Local Lounges</SelectItem>
                          <SelectItem value="brands">Brands & Gear</SelectItem>
                          <SelectItem value="events">Events & Meetups</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                
                <FormField
                  control={form.control}
                  name="customCategory"
                  render={({ field }) => (
                    <FormItem className={form.watch("category") === "other" ? "block" : "hidden"}>
                      <FormLabel className="text-white">Custom Category</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Gaming" className="bg-background/50 border-white/10" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Location (optional)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="City, State" className="pl-9 bg-background/50 border-white/10" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Tags (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. double apple, dark leaf, tangiers (comma separated)" className="bg-background/50 border-white/10" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="bg-card/40 border border-white/5 rounded-3xl p-6 md:p-8 space-y-6">
              <h2 className="text-xl font-serif text-white">Privacy & Visibility</h2>
              
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
                        <FormItem className="flex items-start space-x-3 space-y-0 rounded-xl border border-white/10 p-4 bg-background/30 [&:has([data-state=checked])]:border-primary/50">
                          <FormControl>
                            <RadioGroupItem value="public" className="mt-1 text-primary border-primary" />
                          </FormControl>
                          <div className="space-y-1">
                            <FormLabel className="text-white font-medium flex items-center gap-2">
                              <Globe className="w-4 h-4 text-primary" /> Public
                            </FormLabel>
                            <FormDescription>
                              Anyone can see who's in the group and what they post.
                            </FormDescription>
                          </div>
                        </FormItem>
                        <FormItem className="flex items-start space-x-3 space-y-0 rounded-xl border border-white/10 p-4 bg-background/30 [&:has([data-state=checked])]:border-primary/50">
                          <FormControl>
                            <RadioGroupItem value="private" className="mt-1 text-primary border-primary" />
                          </FormControl>
                          <div className="space-y-1">
                            <FormLabel className="text-white font-medium flex items-center gap-2">
                              <Lock className="w-4 h-4 text-primary" /> Private
                            </FormLabel>
                            <FormDescription>
                              Only members can see who's in the group and what they post.
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
                        <SelectTrigger className="bg-background/50 border-white/10">
                          <SelectValue placeholder="Select visibility" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-card border-white/10">
                        <SelectItem value="visible">Visible (Shows in search)</SelectItem>
                        <SelectItem value="hidden">Hidden (Invite only)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>Visible groups can be found by anyone. Hidden groups require an invite link.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/10">
                <FormField
                  control={form.control}
                  name="postingPermission"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Who can post?</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-background/50 border-white/10">
                            <SelectValue placeholder="Select permission" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-card border-white/10">
                          <SelectItem value="all_members">All Members</SelectItem>
                          <SelectItem value="admins_only">Admins Only</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="postApproval"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-white/10 p-4 bg-background/50 mt-8">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="border-white/20 data-[state=checked]:bg-primary"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-white">Require post approval</FormLabel>
                        <FormDescription>Admins must approve posts before they appear.</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="bg-card/40 border border-white/5 rounded-3xl p-6 md:p-8 space-y-6">
              <h2 className="text-xl font-serif text-white">Visuals</h2>
              
              <div className="space-y-4">
                <label className="text-sm font-medium text-white">Group Icon</label>
                <div className="flex items-center gap-6">
                  <div className="h-20 w-20 rounded-2xl bg-background/50 border border-dashed border-white/20 flex items-center justify-center overflow-hidden shrink-0">
                    {iconFile ? (
                      <img src={URL.createObjectURL(iconFile)} className="w-full h-full object-cover" alt="Icon preview" />
                    ) : (
                      <Users className="w-8 h-8 text-white/20" />
                    )}
                  </div>
                  <div>
                    <Input 
                      type="file" 
                      accept="image/*" 
                      onChange={(e) => setIconFile(e.target.files?.[0] || null)}
                      className="bg-background/50 border-white/10 max-w-xs text-sm"
                    />
                    <p className="text-xs text-muted-foreground mt-2">Recommended: 256x256px</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-white/5">
                <label className="text-sm font-medium text-white">Cover Image</label>
                <div className="space-y-4">
                  {coverFile && (
                    <div className="h-32 w-full rounded-2xl bg-background/50 border border-white/10 overflow-hidden">
                      <img src={URL.createObjectURL(coverFile)} className="w-full h-full object-cover" alt="Cover preview" />
                    </div>
                  )}
                  <div>
                    <Input 
                      type="file" 
                      accept="image/*" 
                      onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
                      className="bg-background/50 border-white/10 max-w-xs text-sm"
                    />
                    <p className="text-xs text-muted-foreground mt-2">Recommended: 1200x400px</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-card/40 border border-white/5 rounded-3xl p-6 md:p-8 space-y-6">
              <h2 className="text-xl font-serif text-white">Onboarding</h2>
              
              <FormField
                control={form.control}
                name="rules"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Group Rules (one per line, optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="1. Be respectful
2. No spam" className="bg-background/50 border-white/10 min-h-[100px]" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="questions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Membership Questions (one per line, optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="What is your favorite hookah flavor?" className="bg-background/50 border-white/10 min-h-[80px]" {...field} />
                    </FormControl>
                    <FormDescription>Ask users questions when they request to join.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="initialInvites"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Initial Invites (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="User IDs separated by commas (e.g. 1, 2, 3)" className="bg-background/50 border-white/10" {...field} />
                    </FormControl>
                    <FormDescription>Invite users immediately after creating the group.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="agreed"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-white/10 p-4 bg-background/50">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        className="border-white/20 data-[state=checked]:bg-primary"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-white font-bold">I agree to the Group Moderation Standards *</FormLabel>
                      <FormDescription>As an owner, you are responsible for keeping this group free of illegal content and spam.</FormDescription>
                    </div>
                  </FormItem>
                )}
              />
            

              <FormField
                control={form.control}
                name="agreedRules"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-white/10 p-4 bg-background/50">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        className="border-white/20 data-[state=checked]:bg-primary"
                        data-testid="agree-rules-checkbox"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-white font-bold">I agree to the Platform Rules *</FormLabel>
                      <FormDescription>I will follow the terms of service and community guidelines.</FormDescription>
                    </div>
                  </FormItem>
                )}
              />

            </div>

            <div className="flex justify-end pt-4 pb-20">
              <Button 
                type="submit" 
                size="lg" 
                disabled={createGroup.isPending || isUploading}
                className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-12 h-14 text-lg w-full md:w-auto shadow-[0_0_20px_rgba(214,181,109,0.3)]"
              >
                {isUploading ? "Uploading Images..." : createGroup.isPending ? "Creating Group..." : "Create Group"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </Layout>
  );
}
