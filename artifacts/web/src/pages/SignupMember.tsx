import { useState } from "react";
import { useRegisterMember } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function SignupMember() {
  const registerMember = useRegisterMember();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [formData, setFormData] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    city: "",
    state: "",
    ageConfirmed: false,
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
    if (!formData.ageConfirmed || !formData.rulesAccepted) {
      toast({ title: "Action Required", description: "Please confirm your age and accept the rules.", variant: "destructive" });
      return;
    }
    
    registerMember.mutate({
      data: formData
    }, {
      onSuccess: () => {
        toast({ title: "Welcome to the Lounge", description: "Account created successfully." });
        setLocation("/pricing");
      },
      onError: () => {
        toast({ title: "Error", description: "Could not create account.", variant: "destructive" });
      }
    });
  };

  return (
    <Layout>
      <div className="flex-1 container mx-auto px-4 py-12 max-w-lg">
        <div className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-[0_0_40px_rgba(232,93,117,0.1)]">
          <h1 className="text-3xl font-serif text-white mb-2 text-center">Join as a Member</h1>
          <p className="text-muted-foreground text-center mb-8">Access exclusive content, private chats, and connect with premium Dolls.</p>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" required value={formData.name} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input id="username" required value={formData.username} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={formData.email} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required value={formData.password} onChange={handleChange} className="bg-background/50 border-white/10" />
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

            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox id="ageConfirmed" checked={formData.ageConfirmed} onCheckedChange={(c) => handleCheckedChange('ageConfirmed', c as boolean)} />
                <Label htmlFor="ageConfirmed" className="text-sm font-normal">I confirm I am 21 years of age or older.</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="rulesAccepted" checked={formData.rulesAccepted} onCheckedChange={(c) => handleCheckedChange('rulesAccepted', c as boolean)} />
                <Label htmlFor="rulesAccepted" className="text-sm font-normal">I agree to the Terms of Service and Privacy Policy.</Label>
              </div>
            </div>

            <Button type="submit" className="w-full bg-gradient-to-r from-primary to-rose-400 hover:from-primary/90 hover:to-rose-400/90 text-primary-foreground font-semibold h-12" disabled={registerMember.isPending}>
              {registerMember.isPending ? "Creating Account..." : "Create Account"}
            </Button>
          </form>
        </div>
      </div>
    </Layout>
  );
}
