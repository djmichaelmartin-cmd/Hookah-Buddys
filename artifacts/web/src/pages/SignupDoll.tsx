import { useEffect, useState } from "react";
import {
  useRegisterDoll,
  useListPlans,
  getListPlansQueryKey,
  updateMyDollProfile,
  type DollRegistrationBuddyType,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Crown, Sparkles, Camera, Check } from "lucide-react";
import {
  uploadImage,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_BYTES,
} from "@/lib/uploadImage";

export default function SignupDoll() {
  const registerDoll = useRegisterDoll();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const searchParams = new URLSearchParams(window.location.search);
  const type = searchParams.get("type");
  const planId = Number(searchParams.get("planId"));
  const { data: dollPlans } = useListPlans(
    { audience: "doll" },
    { query: { queryKey: getListPlansQueryKey({ audience: "doll" }) } },
  );
  const selectedPlan = dollPlans?.find((plan) => plan.id === planId);

  const initialBuddyType =
    type === "female" ? "female_buddy" : type === "male" ? "male_buddy" : "";

  const [formData, setFormData] = useState({
    legalName: "",
    stageName: "",
    email: "",
    password: "",
    confirmPassword: "",
    phone: "",
    city: "",
    state: "",
    age: "",
    bio: "",
    favoriteFlavor: "",
    experienceLevel: "Novice",
    preferences: "",
    buddyType: initialBuddyType as DollRegistrationBuddyType | "",
    ageConfirmed: false,
    rulesAccepted: false,
    tosAccepted: false,
    privacyAccepted: false,
  });
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const profilePhotoPreview = profilePhoto
    ? URL.createObjectURL(profilePhoto)
    : "";
  const invalidWizardPath =
    type !== "female" ||
    (dollPlans !== undefined && (!selectedPlan || !selectedPlan.highlighted));

  useEffect(() => {
    if (invalidWizardPath) setLocation("/choose-membership");
  }, [invalidWizardPath, setLocation]);

  if (invalidWizardPath) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 text-center text-muted-foreground">
          Returning to profile options…
        </div>
      </Layout>
    );
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.id]: e.target.value }));
  };

  const handleCheckedChange = (id: string, checked: boolean) => {
    setFormData((prev) => ({ ...prev, [id]: checked }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan) {
      setLocation("/choose-membership");
      return;
    }
    if (
      !formData.ageConfirmed ||
      !formData.rulesAccepted ||
      !formData.tosAccepted ||
      !formData.privacyAccepted
    ) {
      toast({
        title: "Action Required",
        description: "Please confirm your age and accept all agreements.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.buddyType) {
      toast({
        title: "Action Required",
        description: "Please select a Buddy Type.",
        variant: "destructive",
      });
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Please enter the same password in both fields.",
        variant: "destructive",
      });
      return;
    }

    registerDoll.mutate(
      {
        data: {
          legalName: formData.legalName,
          stageName: formData.stageName,
          email: formData.email,
          password: formData.password,
          phone: formData.phone,
          city: formData.city,
          state: formData.state,
          bio: formData.bio,
          favoriteFlavor: formData.favoriteFlavor,
          experienceLevel: formData.experienceLevel,
          preferences: formData.preferences,
          ageConfirmed: formData.ageConfirmed,
          rulesAccepted: formData.rulesAccepted,
          buddyType: formData.buddyType as DollRegistrationBuddyType,
          planId: selectedPlan.id,
          age: parseInt(formData.age, 10),
        },
      },
      {
        onSuccess: async () => {
          window.localStorage.setItem(
            "creativeBuddyPlanId",
            String(selectedPlan.id),
          );
          if (profilePhoto) {
            try {
              const profilePhotoUrl = await uploadImage(profilePhoto);
              await updateMyDollProfile({ profilePhotoUrl });
            } catch {
              toast({
                title: "Application submitted",
                description:
                  "Your photo could not be uploaded. You can add it later from your profile.",
                variant: "destructive",
              });
            }
          }
          if (selectedPlan) {
            toast({
              title: "Application Submitted",
              description:
                "Complete checkout, then finish identity verification.",
            });
            setLocation(
              `/checkout?type=membership&audience=doll&planId=${selectedPlan.id}`,
            );
          } else {
            toast({
              title: "Application Submitted",
              description: "Please complete verification.",
            });
            setLocation("/verification");
          }
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Could not submit application.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Layout>
      <div className="flex-1 container mx-auto px-4 py-12 max-w-3xl">
        <div className="bg-card/60 backdrop-blur-xl border border-[#D6B56D]/30 rounded-3xl p-8 lg:p-12 shadow-[0_0_50px_rgba(214,181,109,0.15)] relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <Crown className="w-48 h-48 text-[#D6B56D]" />
          </div>

          <div className="relative z-10 text-center mb-10">
            <span className="inline-flex items-center gap-1.5 bg-[#D6B56D]/10 text-[#D6B56D] text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full mb-4">
              <Sparkles className="w-3.5 h-3.5" /> Creator Program
            </span>
            <h1 className="text-4xl font-serif text-white mb-3">
              Become a Creative Buddy
            </h1>
            <p className="text-muted-foreground text-lg max-w-lg mx-auto">
              Join the exclusive creator platform. Monetize your content, set
              your own rates, and keep 100% of your earnings.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label htmlFor="legalName">Legal Name</Label>
                <Input
                  id="legalName"
                  required
                  value={formData.legalName}
                  onChange={handleChange}
                  className="bg-background/50 border-white/10 h-12 focus-visible:ring-[#D6B56D]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stageName">Stage Name</Label>
                <Input
                  id="stageName"
                  required
                  value={formData.stageName}
                  onChange={handleChange}
                  className="bg-background/50 border-white/10 h-12 focus-visible:ring-[#D6B56D]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  className="bg-background/50 border-white/10 h-12 focus-visible:ring-[#D6B56D]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={formData.password}
                  onChange={handleChange}
                  className="bg-background/50 border-white/10 h-12 focus-visible:ring-[#D6B56D]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <PasswordInput
                  id="confirmPassword"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className="bg-background/50 border-white/10 h-12 focus-visible:ring-[#D6B56D]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone (Optional)</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={handleChange}
                  className="bg-background/50 border-white/10 h-12 focus-visible:ring-[#D6B56D]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  required
                  value={formData.city}
                  onChange={handleChange}
                  className="bg-background/50 border-white/10 h-12 focus-visible:ring-[#D6B56D]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  required
                  value={formData.state}
                  onChange={handleChange}
                  className="bg-background/50 border-white/10 h-12 focus-visible:ring-[#D6B56D]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="age">Age</Label>
                <Input
                  id="age"
                  type="number"
                  required
                  value={formData.age}
                  onChange={handleChange}
                  className="bg-background/50 border-white/10 h-12 focus-visible:ring-[#D6B56D]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="favoriteFlavor">Favorite Hookah Flavor</Label>
                <Input
                  id="favoriteFlavor"
                  required
                  value={formData.favoriteFlavor}
                  onChange={handleChange}
                  className="bg-background/50 border-white/10 h-12 focus-visible:ring-[#D6B56D]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profilePhoto">Profile Photo (Optional)</Label>
                <label className="flex h-12 cursor-pointer items-center gap-3 rounded-md border border-white/10 bg-background/50 px-3 text-sm text-muted-foreground hover:border-[#D6B56D]/30">
                  {profilePhotoPreview ? (
                    <img
                      src={profilePhotoPreview}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <Camera className="h-5 w-5" />
                  )}
                  <span className="truncate">
                    {profilePhoto?.name || "Choose a photo"}
                  </span>
                  <input
                    id="profilePhoto"
                    type="file"
                    accept={ALLOWED_IMAGE_TYPES.join(",")}
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (
                        !ALLOWED_IMAGE_TYPES.includes(file.type) ||
                        file.size > MAX_IMAGE_SIZE_BYTES
                      ) {
                        toast({
                          title: "Invalid photo",
                          description: "Choose a supported image up to 10 MB.",
                          variant: "destructive",
                        });
                        event.target.value = "";
                        return;
                      }
                      setProfilePhoto(file);
                    }}
                  />
                </label>
              </div>

              <div className="space-y-2 col-span-1 md:col-span-2">
                <Label htmlFor="buddyType">Buddy Type (Required)</Label>
                {type ? (
                  <div className="flex items-center px-4 h-12 rounded-xl border bg-[#D6B56D]/10 border-[#D6B56D]/30 text-[#D6B56D]">
                    <Crown className="w-5 h-5 mr-3" />
                    <span className="font-medium text-lg">
                      {type === "female" ? "Female Buddy" : "Male Buddy"}
                    </span>
                  </div>
                ) : (
                  <Select
                    value={formData.buddyType}
                    onValueChange={(v) =>
                      setFormData((prev) => ({
                        ...prev,
                        buddyType: v as DollRegistrationBuddyType,
                      }))
                    }
                  >
                    <SelectTrigger className="bg-background/50 border-white/10 h-12 focus-visible:ring-[#D6B56D]">
                      <SelectValue placeholder="Select Buddy Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="female_buddy">Female Buddy</SelectItem>
                      <SelectItem value="male_buddy">Male Buddy</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  This sets your public profile style.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                required
                value={formData.bio}
                onChange={handleChange}
                className="bg-background/50 border-white/10 min-h-[120px] focus-visible:ring-[#D6B56D] resize-none"
                placeholder="Tell the community about yourself..."
              />
            </div>

            <div className="bg-[#D6B56D]/5 border border-[#D6B56D]/20 rounded-xl p-5 my-8">
              <h3 className="font-semibold text-[#D6B56D] mb-2 flex items-center gap-2">
                <Crown className="w-4 h-4" /> Mandatory Brand Standard
              </h3>
              <p className="text-sm text-zinc-300 leading-relaxed">
                All uploaded content on the HookahBuddys platform must include a
                visible hookah. No explicit content is allowed. By applying to
                be a Creative Buddy, you agree to uphold these standards.
              </p>
            </div>

            <div className="space-y-4 pt-4 border-t border-white/5">
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="ageConfirmed"
                  checked={formData.ageConfirmed}
                  onCheckedChange={(c) =>
                    handleCheckedChange("ageConfirmed", c as boolean)
                  }
                  className="data-[state=checked]:bg-[#D6B56D] data-[state=checked]:text-[#111]"
                />
                <Label
                  htmlFor="ageConfirmed"
                  className="text-sm font-normal text-zinc-300"
                >
                  I confirm I am 21 years of age or older.
                </Label>
              </div>
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="rulesAccepted"
                  checked={formData.rulesAccepted}
                  onCheckedChange={(c) =>
                    handleCheckedChange("rulesAccepted", c as boolean)
                  }
                  className="data-[state=checked]:bg-[#D6B56D] data-[state=checked]:text-[#111]"
                />
                <Label
                  htmlFor="rulesAccepted"
                  className="text-sm font-normal text-zinc-300"
                >
                  I agree to the Platform Rules, including that all uploaded
                  content will feature a visible hookah.
                </Label>
              </div>
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="tosAccepted"
                  checked={formData.tosAccepted}
                  onCheckedChange={(c) =>
                    handleCheckedChange("tosAccepted", c as boolean)
                  }
                  className="data-[state=checked]:bg-[#D6B56D] data-[state=checked]:text-[#111]"
                />
                <Label
                  htmlFor="tosAccepted"
                  className="text-sm font-normal text-zinc-300"
                >
                  I agree to the Terms of Service.
                </Label>
              </div>
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="privacyAccepted"
                  checked={formData.privacyAccepted}
                  onCheckedChange={(c) =>
                    handleCheckedChange("privacyAccepted", c as boolean)
                  }
                  className="data-[state=checked]:bg-[#D6B56D] data-[state=checked]:text-[#111]"
                />
                <Label
                  htmlFor="privacyAccepted"
                  className="text-sm font-normal text-zinc-300"
                >
                  I agree to the Privacy Policy.
                </Label>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] font-bold text-lg h-14 rounded-xl mt-8"
              disabled={registerDoll.isPending}
            >
              {registerDoll.isPending
                ? "Submitting Application..."
                : "Submit Application"}
            </Button>
          </form>

          {selectedPlan && (
            <aside className="relative z-10 mt-8 rounded-2xl border border-[#D6B56D]/30 bg-[#D6B56D]/5 p-6">
              <p className="text-xs font-bold uppercase tracking-wider text-[#D6B56D]">
                Selected Path
              </p>
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-serif text-white">
                  Creative Buddy
                </h2>
                <p className="text-xl font-bold text-[#D6B56D]">
                  ${selectedPlan.price}/{selectedPlan.interval || "month"}
                </p>
              </div>
              <p className="mt-3 text-sm text-zinc-300">
                You will complete secure checkout after creating your account,
                then continue to identity verification.
              </p>
              <ul className="mt-4 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
                {selectedPlan.features?.slice(0, 4).map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#D6B56D]" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      </div>
    </Layout>
  );
}
