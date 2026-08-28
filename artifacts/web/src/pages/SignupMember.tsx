import { useState, useEffect } from "react";
import { useRegisterMember, useListPlans, getListPlansQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Coins } from "lucide-react";

export default function SignupMember() {
  const registerMember = useRegisterMember();
  const { data: plans } = useListPlans({ audience: "member" }, { query: { queryKey: getListPlansQueryKey({ audience: "member" }) } });

  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const searchParams = new URLSearchParams(window.location.search);
  const planSlug = searchParams.get("plan") || "bronze";

  const selectedPlan = plans?.find(p => p.slug === planSlug);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    username: "",
    email: "",
    password: "",
    city: "",
    state: "",
    ageConfirmed: false,
    tosAccepted: false,
    privacyAccepted: false,
    rulesAccepted: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.id]: e.target.value }));
  };

  const handleCheckedChange = (id: string, checked: boolean) => {
    setFormData(prev => ({ ...prev, [id]: checked }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.ageConfirmed) {
      toast({ title: "Age Confirmation", description: "You must confirm you are 21 or older.", variant: "destructive" });
      return;
    }
    if (!formData.tosAccepted || !formData.privacyAccepted || !formData.rulesAccepted) {
      toast({ title: "Action Required", description: "Please accept all required agreements.", variant: "destructive" });
      return;
    }

    const combinedName = `${formData.firstName.trim()} ${formData.lastName.trim()}`.trim();

    registerMember.mutate({
      data: {
        name: combinedName,
        username: formData.username,
        email: formData.email,
        password: formData.password,
        city: formData.city,
        state: formData.state,
        phone: formData.phone,
        ageConfirmed: formData.ageConfirmed,
        rulesAccepted: formData.rulesAccepted
      }
    }, {
      onSuccess: () => {
        toast({ title: "Welcome to the Lounge", description: "Account created successfully." });
        if (selectedPlan && selectedPlan.price > 0 && selectedPlan.slug) {
          setLocation(`/checkout?type=membership&plan=${selectedPlan.slug}`);
        } else {
          toast({ title: "Want premium features?", description: "Buy some credits to unlock premium photos and videos.", variant: "default" });
          setLocation("/dashboard/member");
        }
      },
      onError: () => {
        toast({ title: "Error", description: "Could not create account.", variant: "destructive" });
      }
    });
  };

  return (
    <Layout>
      <div className="flex-1 container mx-auto px-4 py-12 max-w-4xl flex gap-8 flex-col lg:flex-row items-start">
        <div className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-[0_0_40px_rgba(24,119,242,0.05)] flex-1 w-full">
          <h1 className="text-3xl font-serif text-white mb-2 text-center">
            {selectedPlan && selectedPlan.price > 0 ? "Join as a Member" : "Create Your Free Profile"}
          </h1>
          <p className="text-muted-foreground text-center mb-8">
            {selectedPlan && selectedPlan.price > 0
              ? "Create your profile to join the lounge."
              : "Join the HookahBuddys social community for free — post, follow, make Buddys, and explore the Lounge. Upgrade anytime."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input id="firstName" required value={formData.firstName} onChange={handleChange} className="bg-background/50 border-white/10" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input id="lastName" required value={formData.lastName} onChange={handleChange} className="bg-background/50 border-white/10" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input id="username" required value={formData.username} onChange={handleChange} className="bg-background/50 border-white/10" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone (Optional)</Label>
                  <Input id="phone" type="tel" value={formData.phone} onChange={handleChange} className="bg-background/50 border-white/10" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={formData.email} onChange={handleChange} className="bg-background/50 border-white/10" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" required minLength={6} value={formData.password} onChange={handleChange} className="bg-background/50 border-white/10" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City (Optional)</Label>
                  <Input id="city" value={formData.city} onChange={handleChange} className="bg-background/50 border-white/10" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State (Optional)</Label>
                  <Input id="state" value={formData.state} onChange={handleChange} className="bg-background/50 border-white/10" />
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-white/10">
              <div className="flex items-center space-x-2">
                <Checkbox id="ageConfirmed" checked={formData.ageConfirmed} onCheckedChange={(c) => handleCheckedChange('ageConfirmed', c as boolean)} />
                <Label htmlFor="ageConfirmed" className="text-sm font-normal">I confirm I am 21 years of age or older.</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="tosAccepted" checked={formData.tosAccepted} onCheckedChange={(c) => handleCheckedChange('tosAccepted', c as boolean)} />
                <Label htmlFor="tosAccepted" className="text-sm font-normal">I agree to the Terms of Service.</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="privacyAccepted" checked={formData.privacyAccepted} onCheckedChange={(c) => handleCheckedChange('privacyAccepted', c as boolean)} />
                <Label htmlFor="privacyAccepted" className="text-sm font-normal">I agree to the Privacy Policy.</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="rulesAccepted" checked={formData.rulesAccepted} onCheckedChange={(c) => handleCheckedChange('rulesAccepted', c as boolean)} />
                <Label htmlFor="rulesAccepted" className="text-sm font-normal">I agree to the Platform Rules.</Label>
              </div>
            </div>

            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-12" disabled={registerMember.isPending}>
              {registerMember.isPending ? "Creating Account..." : "Create Account"}
            </Button>
          </form>
        </div>

        {selectedPlan && selectedPlan.price > 0 && (
          <div className="w-full lg:w-80 shrink-0 bg-card/60 backdrop-blur-xl border border-primary/20 rounded-2xl p-6 shadow-[0_0_40px_rgba(24,119,242,0.1)]">
            <h2 className="text-xl font-serif text-white mb-4">Membership Plan</h2>
            <div className="flex items-baseline justify-between mb-4">
              <span className="text-lg font-medium text-white">{selectedPlan.name}</span>
              <span className="text-2xl font-bold text-primary">${selectedPlan.price}</span>
            </div>

            <div className="mb-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
              <p className="text-sm font-semibold text-white flex items-center gap-2">
                <Coins className="w-4 h-4 text-primary" />
                {selectedPlan.monthlyCredits} credits / mo
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              By creating your account, you will be redirected to complete your subscription purchase. You will be billed ${selectedPlan.price} per month until you cancel.
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
