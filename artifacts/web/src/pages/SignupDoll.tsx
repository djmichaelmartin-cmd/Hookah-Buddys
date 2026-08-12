import { useState } from "react";
import { useRegisterDoll } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function SignupDoll() {
  const registerDoll = useRegisterDoll();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [formData, setFormData] = useState({
    legalName: "",
    stageName: "",
    email: "",
    password: "",
    phone: "",
    city: "",
    state: "",
    age: "",
    bio: "",
    favoriteFlavor: "",
    experienceLevel: "Novice",
    preferences: "",
    ageConfirmed: false,
    rulesAccepted: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [e.target.id]: e.target.value }));
  };

  const handleCheckedChange = (id: string, checked: boolean) => {
    setFormData(prev => ({ ...prev, [id]: checked }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.ageConfirmed || !formData.rulesAccepted) {
      toast({ title: "Action Required", description: "Please confirm your age and accept the rules.", variant: "destructive" });
      return;
    }
    
    registerDoll.mutate({
      data: {
        ...formData,
        age: parseInt(formData.age, 10),
      }
    }, {
      onSuccess: () => {
        toast({ title: "Application Submitted", description: "Please complete verification." });
        setLocation("/verification");
      },
      onError: () => {
        toast({ title: "Error", description: "Could not submit application.", variant: "destructive" });
      }
    });
  };

  return (
    <Layout>
      <div className="flex-1 container mx-auto px-4 py-12 max-w-2xl">
        <div className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-[0_0_40px_rgba(24,119,242,0.1)]">
          <h1 className="text-3xl font-serif text-white mb-2 text-center">Become a Doll</h1>
          <p className="text-muted-foreground text-center mb-8">Join the exclusive hookah lounge creator platform.</p>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="legalName">Legal Name</Label>
                <Input id="legalName" required value={formData.legalName} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stageName">Stage Name</Label>
                <Input id="stageName" required value={formData.stageName} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={formData.email} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required value={formData.password} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input id="city" required value={formData.city} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input id="state" required value={formData.state} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="age">Age</Label>
                <Input id="age" type="number" required value={formData.age} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="favoriteFlavor">Favorite Hookah Flavor</Label>
                <Input id="favoriteFlavor" required value={formData.favoriteFlavor} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea id="bio" required value={formData.bio} onChange={handleChange} className="bg-background/50 border-white/10 min-h-[100px]" />
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-primary mb-2">Mandatory Rule</h3>
              <p className="text-sm text-muted-foreground">All Doll content must include a visible hookah. No explicit content is allowed. By applying, you agree to these brand standards.</p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox id="ageConfirmed" checked={formData.ageConfirmed} onCheckedChange={(c) => handleCheckedChange('ageConfirmed', c as boolean)} />
                <Label htmlFor="ageConfirmed" className="text-sm font-normal">I confirm I am 21 years of age or older.</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="rulesAccepted" checked={formData.rulesAccepted} onCheckedChange={(c) => handleCheckedChange('rulesAccepted', c as boolean)} />
                <Label htmlFor="rulesAccepted" className="text-sm font-normal">I confirm all uploaded content will feature a visible hookah.</Label>
              </div>
            </div>

            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-12" disabled={registerDoll.isPending}>
              {registerDoll.isPending ? "Submitting..." : "Submit Application"}
            </Button>
          </form>
        </div>
      </div>
    </Layout>
  );
}
