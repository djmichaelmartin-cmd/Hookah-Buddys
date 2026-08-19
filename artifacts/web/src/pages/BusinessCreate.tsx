import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { useCreateBusiness, useGetCurrentUser } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Briefcase, Building2, Store, Users, MapPin, Tag } from "lucide-react";
import { uploadImage } from "@/lib/uploadImage";

const createBusinessSchema = z.object({
  handle: z.string()
    .min(2, "Handle must be at least 2 characters")
    .max(30, "Handle must be at most 30 characters")
    .regex(/^[a-zA-Z0-9_.]+$/, "Handle can only contain letters, numbers, underscores, and periods"),
  name: z.string().min(1, "Name is required").max(100),
  businessType: z.string().min(1, "Business type is required"),
  category: z.string().optional(),
  tagline: z.string().max(150).optional(),
  description: z.string().max(2000).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  logoUrl: z.string().optional(),
  coverUrl: z.string().optional(),
});

type CreateBusinessForm = z.infer<typeof createBusinessSchema>;

export default function BusinessCreate() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { data: session, isLoading: isSessionLoading } = useGetCurrentUser();

  const createBusiness = useCreateBusiness({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Business page created!", description: "Welcome to your new dashboard." });
        setLocation(`/dashboard/business/${data.handle}`);
      },
      onError: (err: unknown) => {
        toast({ 
          title: "Creation failed", 
          description: getErrorMessage(err) || "Could not create business page.",
          variant: "destructive"
        });
      }
    }
  });

  const form = useForm<CreateBusinessForm>({
    resolver: zodResolver(createBusinessSchema),
    defaultValues: {
      handle: "",
      name: "",
      businessType: "lounge",
      category: "Nightlife",
      tagline: "",
      description: "",
      city: "",
      state: "",
      logoUrl: "",
      coverUrl: "",
    }
  });

  const onSubmit = async (data: CreateBusinessForm) => {
    setIsUploading(true);
    let logoUrl = data.logoUrl;
    let coverUrl = data.coverUrl;

    try {
      if (logoFile) {
        logoUrl = await uploadImage(logoFile);
      }
      if (coverFile) {
        coverUrl = await uploadImage(coverFile);
      }

      createBusiness.mutate({
        data: {
          ...data,
          logoUrl,
          coverUrl,
        }
      });
    } catch (err: unknown) {
      toast({ title: "Upload failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  if (isSessionLoading) {
    return (
      <Layout>
        <div className="container mx-auto max-w-3xl px-4 py-24">
          <div className="h-64 animate-pulse rounded-3xl border border-white/10 bg-card/50" />
        </div>
      </Layout>
    );
  }

  if (!session?.authenticated) {
    return (
      <Layout>
        <div className="container mx-auto max-w-2xl px-4 py-24 text-center">
          <div className="rounded-3xl border border-white/10 bg-card p-8 shadow-xl md:p-12">
            <Building2 className="mx-auto mb-5 h-12 w-12 text-[#D6B56D]" />
            <h1 className="mb-3 font-serif text-3xl text-white">Sign in to create a Business Page</h1>
            <p className="mx-auto mb-8 max-w-lg text-white/65">
              Business Pages are managed from your HookahBuddys account. Sign in first, then return here to create and manage your page.
            </p>
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <Button onClick={() => setLocation("/login")} className="rounded-full bg-[#D6B56D] px-8 text-[#111] hover:bg-[#C9A456]">
                Sign In
              </Button>
              <Button variant="outline" onClick={() => setLocation("/signup/member")} className="rounded-full border-white/15 px-8 text-white">
                Create Free Profile
              </Button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <div className="mb-10">
          <h1 className="text-4xl font-serif text-white mb-3">Create a Business Page</h1>
          <p className="text-white/70 text-lg">Establish your presence on HookahBuddys. Connect with members, share updates, and grow your brand.</p>
        </div>

        <div className="bg-card border border-white/10 rounded-3xl p-6 md:p-10 shadow-xl">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3">
                  <Store className="w-5 h-5 text-[#D6B56D]" /> Profile Identity
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/90">Business Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Cloud Nine Lounge" className="bg-background/50 border-white/10 focus-visible:ring-[#D6B56D]" {...field} />
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
                        <FormLabel className="text-white/90">Unique Handle</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">@</span>
                            <Input placeholder="cloud9lounge" className="pl-9 bg-background/50 border-white/10 focus-visible:ring-[#D6B56D]" {...field} onChange={e => field.onChange(e.target.value.toLowerCase())} />
                          </div>
                        </FormControl>
                        <FormDescription className="text-xs">Used for your profile URL: hookahbuddys.com/business/@{field.value}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="businessType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/90">Business Type</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Lounge, Brand, Service..." className="bg-background/50 border-white/10 focus-visible:ring-[#D6B56D]" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/90">Category</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Nightlife, Hookah Tobacco, DJ..." className="bg-background/50 border-white/10 focus-visible:ring-[#D6B56D]" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3">
                  <Tag className="w-5 h-5 text-[#D6B56D]" /> About & Details
                </h3>

                <FormField
                  control={form.control}
                  name="tagline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white/90">Tagline (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Short, catchy phrase..." className="bg-background/50 border-white/10 focus-visible:ring-[#D6B56D]" {...field} />
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
                      <FormLabel className="text-white/90">Description (Optional)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Tell everyone what makes your business special..." className="bg-background/50 border-white/10 min-h-[120px] focus-visible:ring-[#D6B56D]" {...field} />
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
                        <FormLabel className="text-white/90">City (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Miami" className="bg-background/50 border-white/10 focus-visible:ring-[#D6B56D]" {...field} />
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
                        <FormLabel className="text-white/90">State (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. FL" className="bg-background/50 border-white/10 focus-visible:ring-[#D6B56D]" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-xl font-bold text-white flex items-center gap-2 border-b border-white/10 pb-3">
                  <Building2 className="w-5 h-5 text-[#D6B56D]" /> Visual Identity
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <label className="block text-sm font-medium text-white/90">Logo</label>
                    <p className="mb-3 mt-1 text-xs text-muted-foreground">Square image, recommended 400x400px.</p>
                    <div className="flex items-center gap-4">
                      <div className="w-20 h-20 rounded-xl bg-background/50 border border-white/10 flex items-center justify-center overflow-hidden">
                        {logoFile ? (
                          <img src={URL.createObjectURL(logoFile)} alt="Logo preview" className="w-full h-full object-cover" />
                        ) : (
                          <Store className="w-8 h-8 text-white/20" />
                        )}
                      </div>
                      <Input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} className="flex-1 bg-background/50 border-white/10 text-white/80 file:text-white" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white/90">Cover Photo</label>
                    <p className="mb-3 mt-1 text-xs text-muted-foreground">Landscape image, recommended 1200x400px.</p>
                    <div className="space-y-3">
                      <div className="w-full h-20 rounded-xl bg-background/50 border border-white/10 flex items-center justify-center overflow-hidden">
                        {coverFile ? (
                          <img src={URL.createObjectURL(coverFile)} alt="Cover preview" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-white/20 text-sm">Cover Preview</span>
                        )}
                      </div>
                      <Input type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} className="w-full bg-background/50 border-white/10 text-white/80 file:text-white" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-6 flex justify-end gap-4">
                <Button type="button" variant="ghost" onClick={() => setLocation("/businesses")} className="text-white hover:bg-white/10 rounded-full px-6">Cancel</Button>
                <Button 
                  type="submit" 
                  disabled={isUploading || createBusiness.isPending} 
                  className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-8 font-bold"
                >
                  {isUploading || createBusiness.isPending ? "Creating Page..." : "Create Business Page"}
                </Button>
              </div>

            </form>
          </Form>
        </div>
      </div>
    </Layout>
  );
}
