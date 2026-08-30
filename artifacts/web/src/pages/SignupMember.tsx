import { useEffect, useState } from "react";
import {
  useRegisterMember,
  useListPlans,
  getListPlansQueryKey,
  useCreateCheckout,
  useListCreditPackages,
  updateMyProfile,
  type MemberRegistrationBuddyType,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
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
import { Coins, User, Sparkles, Camera } from "lucide-react";
import {
  uploadImage,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_BYTES,
} from "@/lib/uploadImage";

export default function SignupMember() {
  const registerMember = useRegisterMember();
  const createCheckout = useCreateCheckout();

  const { data: plans } = useListPlans(
    { audience: "member" },
    { query: { queryKey: getListPlansQueryKey({ audience: "member" }) } },
  );
  const { data: packages } = useListCreditPackages();

  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const searchParams = new URLSearchParams(window.location.search);
  const type = searchParams.get("type"); // 'male' or 'female'
  const planSlug = searchParams.get("plan") || "bronze";
  const packageId = searchParams.get("package");

  const selectedPlan = plans?.find((p) => p.slug === planSlug);
  const selectedPackage = packages?.find((p) => p.id === Number(packageId));

  const initialBuddyType =
    type === "female" ? "female_buddy" : type === "male" ? "male_buddy" : "";

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    displayName: "",
    phone: "",
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    city: "",
    state: "",
    buddyType: initialBuddyType as MemberRegistrationBuddyType | "",
    ageConfirmed: false,
    tosAccepted: false,
    privacyAccepted: false,
    rulesAccepted: false,
  });
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const profilePhotoPreview = profilePhoto
    ? URL.createObjectURL(profilePhoto)
    : "";
  const invalidWizardPath =
    (type !== "male" && type !== "female") ||
    (type === "female" && (planSlug !== "bronze" || Boolean(packageId))) ||
    (Boolean(packageId) && (type !== "male" || planSlug !== "bronze")) ||
    (plans !== undefined && !selectedPlan);

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.id]: e.target.value }));
  };

  const handleCheckedChange = (id: string, checked: boolean) => {
    setFormData((prev) => ({ ...prev, [id]: checked }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.ageConfirmed) {
      toast({
        title: "Age Confirmation",
        description: "You must confirm you are 21 or older.",
        variant: "destructive",
      });
      return;
    }
    if (
      !formData.tosAccepted ||
      !formData.privacyAccepted ||
      !formData.rulesAccepted
    ) {
      toast({
        title: "Action Required",
        description: "Please accept all required agreements.",
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

    registerMember.mutate(
      {
        data: {
          name: formData.displayName.trim(),
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          username: formData.username,
          email: formData.email,
          password: formData.password,
          city: formData.city,
          state: formData.state,
          phone: formData.phone,
          buddyType: formData.buddyType as MemberRegistrationBuddyType,
          ageConfirmed: formData.ageConfirmed,
          rulesAccepted: formData.rulesAccepted,
        },
      },
      {
        onSuccess: async () => {
          toast({
            title: "Welcome to the Lounge",
            description: "Account created successfully.",
          });

          if (profilePhoto) {
            try {
              const profilePhotoUrl = await uploadImage(profilePhoto);
              await updateMyProfile({ profilePhotoUrl });
            } catch {
              toast({
                title: "Profile created",
                description:
                  "Your photo could not be uploaded. You can add it later from Edit Profile.",
                variant: "destructive",
              });
            }
          }

          if (selectedPlan && selectedPlan.price > 0 && selectedPlan.slug) {
            setLocation(`/checkout?type=membership&plan=${selectedPlan.slug}`);
          } else if (selectedPackage) {
            createCheckout.mutate(
              {
                data: {
                  purpose: "credits",
                  amount: selectedPackage.priceCents / 100,
                  referenceId: selectedPackage.id,
                },
              },
              {
                onSuccess: (data) => {
                  if (data.url) {
                    window.location.href = data.url;
                  } else {
                    setLocation("/dashboard/member");
                  }
                },
                onError: () => {
                  toast({
                    title: "Notice",
                    description:
                      "Account created, but couldn't load checkout for credits.",
                    variant: "destructive",
                  });
                  setLocation("/dashboard/member");
                },
              },
            );
          } else {
            toast({
              title: "Profile Created",
              description: "Welcome to HookahBuddys.",
              variant: "default",
            });
            setLocation("/dashboard/member");
          }
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Could not create account.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const isFemale = type === "female";
  const accentClass = isFemale ? "text-pink-400" : "text-blue-400";
  const borderClass = isFemale ? "border-pink-500/20" : "border-blue-500/20";
  const bgSoftClass = isFemale ? "bg-pink-500/10" : "bg-blue-500/10";
  const shadowClass = isFemale
    ? "shadow-[0_0_40px_rgba(236,72,153,0.1)]"
    : "shadow-[0_0_40px_rgba(59,130,246,0.1)]";
  const btnClass = isFemale
    ? "bg-pink-600 hover:bg-pink-700 text-white"
    : "bg-blue-600 hover:bg-blue-700 text-white";

  return (
    <Layout>
      <div className="flex-1 container mx-auto px-4 py-12 max-w-5xl flex gap-8 flex-col lg:flex-row items-start">
        <div
          className={`bg-card/60 backdrop-blur-xl border ${borderClass} rounded-3xl p-8 lg:p-10 ${shadowClass} flex-1 w-full`}
        >
          <h1 className="text-3xl lg:text-4xl font-serif text-white mb-3 text-center">
            {selectedPlan && selectedPlan.price > 0
              ? "Join as a Member"
              : "Create Your Free Profile"}
          </h1>
          <p className="text-muted-foreground text-center mb-10 max-w-lg mx-auto">
            {selectedPlan && selectedPlan.price > 0
              ? "Complete your profile details below to start your premium membership."
              : "Join the HookahBuddys social community for free. Upgrade anytime."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    required
                    value={formData.firstName}
                    onChange={handleChange}
                    className="bg-background/50 border-white/10 h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    required
                    value={formData.lastName}
                    onChange={handleChange}
                    className="bg-background/50 border-white/10 h-12"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input
                  id="displayName"
                  required
                  value={formData.displayName}
                  onChange={handleChange}
                  className="bg-background/50 border-white/10 h-12"
                  placeholder="The name shown on your public profile"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    required
                    value={formData.username}
                    onChange={handleChange}
                    className="bg-background/50 border-white/10 h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone (Optional)</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={handleChange}
                    className="bg-background/50 border-white/10 h-12"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    className="bg-background/50 border-white/10 h-12"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <PasswordInput
                    id="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={formData.password}
                    onChange={handleChange}
                    className="bg-background/50 border-white/10 h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <PasswordInput
                    id="confirmPassword"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    className="bg-background/50 border-white/10 h-12"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="buddyType">Buddy Type (Required)</Label>
                  {type ? (
                    <div
                      className={`flex items-center px-4 h-12 rounded-xl border ${bgSoftClass} ${isFemale ? "border-pink-500/30" : "border-blue-500/30"} ${accentClass}`}
                    >
                      {isFemale ? (
                        <Sparkles className="w-5 h-5 mr-2" />
                      ) : (
                        <User className="w-5 h-5 mr-2" />
                      )}
                      <span className="font-medium">
                        {isFemale ? "Female Buddy" : "Male Buddy"}
                      </span>
                    </div>
                  ) : (
                    <Select
                      value={formData.buddyType}
                      onValueChange={(v) =>
                        setFormData((prev) => ({
                          ...prev,
                          buddyType: v as MemberRegistrationBuddyType,
                        }))
                      }
                    >
                      <SelectTrigger className="bg-background/50 border-white/10 h-12">
                        <SelectValue placeholder="Select Buddy Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="female_buddy">
                          Female Buddy
                        </SelectItem>
                        <SelectItem value="male_buddy">Male Buddy</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    This controls the color style of your public Buddy pill.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profilePhoto">Profile Photo (Optional)</Label>
                  <label className="flex h-12 cursor-pointer items-center gap-3 rounded-md border border-white/10 bg-background/50 px-3 text-sm text-muted-foreground hover:border-white/20">
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
                            description:
                              "Choose a supported image up to 10 MB.",
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
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City (Optional)</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={handleChange}
                    className="bg-background/50 border-white/10 h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State (Optional)</Label>
                  <Input
                    id="state"
                    value={formData.state}
                    onChange={handleChange}
                    className="bg-background/50 border-white/10 h-12"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-6 mt-6 border-t border-white/5">
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="ageConfirmed"
                  checked={formData.ageConfirmed}
                  onCheckedChange={(c) =>
                    handleCheckedChange("ageConfirmed", c as boolean)
                  }
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
                  id="tosAccepted"
                  checked={formData.tosAccepted}
                  onCheckedChange={(c) =>
                    handleCheckedChange("tosAccepted", c as boolean)
                  }
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
                />
                <Label
                  htmlFor="privacyAccepted"
                  className="text-sm font-normal text-zinc-300"
                >
                  I agree to the Privacy Policy.
                </Label>
              </div>
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="rulesAccepted"
                  checked={formData.rulesAccepted}
                  onCheckedChange={(c) =>
                    handleCheckedChange("rulesAccepted", c as boolean)
                  }
                />
                <Label
                  htmlFor="rulesAccepted"
                  className="text-sm font-normal text-zinc-300"
                >
                  I agree to the Platform Rules.
                </Label>
              </div>
            </div>

            <Button
              type="submit"
              className={`w-full font-bold h-14 rounded-xl mt-4 ${btnClass}`}
              disabled={registerMember.isPending || createCheckout.isPending}
            >
              {registerMember.isPending || createCheckout.isPending
                ? "Processing..."
                : "Create Profile"}
            </Button>
          </form>
        </div>

        {(selectedPlan || selectedPackage) && (
          <div className="w-full lg:w-[340px] shrink-0 space-y-6">
            {selectedPlan && (
              <div
                className={`bg-card/60 backdrop-blur-xl border ${borderClass} rounded-3xl p-6 ${shadowClass}`}
              >
                <h2 className="text-sm uppercase tracking-wider text-muted-foreground font-semibold mb-4">
                  Membership
                </h2>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xl font-serif text-white">
                    {selectedPlan.name}
                  </span>
                  <span className={`text-2xl font-bold ${accentClass}`}>
                    {selectedPlan.price > 0 ? `$${selectedPlan.price}` : "Free"}
                  </span>
                </div>
                {selectedPlan.price > 0 && (
                  <div
                    className={`mt-6 mb-2 rounded-xl border ${isFemale ? "border-pink-500/20" : "border-blue-500/20"} ${bgSoftClass} px-4 py-3`}
                  >
                    <p className="text-sm font-semibold text-white flex items-center gap-2">
                      <Coins className={`w-4 h-4 ${accentClass}`} />
                      {selectedPlan.monthlyCredits} credits / mo
                    </p>
                  </div>
                )}
              </div>
            )}

            {selectedPackage && (
              <div
                className={`bg-card/60 backdrop-blur-xl border ${borderClass} rounded-3xl p-6 ${shadowClass}`}
              >
                <h2 className="text-sm uppercase tracking-wider text-muted-foreground font-semibold mb-4">
                  Add-On
                </h2>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xl font-serif text-white">
                    {selectedPackage.name}
                  </span>
                  <span className={`text-2xl font-bold ${accentClass}`}>
                    ${(selectedPackage.priceCents / 100).toFixed(2)}
                  </span>
                </div>
                <div
                  className={`mt-6 mb-2 rounded-xl border ${isFemale ? "border-pink-500/20" : "border-blue-500/20"} ${bgSoftClass} px-4 py-3`}
                >
                  <p className="text-sm font-semibold text-white flex items-center gap-2">
                    <Coins className={`w-4 h-4 ${accentClass}`} />
                    {selectedPackage.credits.toLocaleString()} credits
                  </p>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground leading-relaxed px-2">
              By creating your account, you agree to our Terms of Service.
              {((selectedPlan && selectedPlan.price > 0) || selectedPackage) &&
                " You will be redirected to complete your purchase after your profile is created."}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
