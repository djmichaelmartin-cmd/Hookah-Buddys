import { useState } from "react";
import { useLogin } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { PROFILE_ENTRY_PATH } from "@/lib/routes";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate({ data: { email, password } }, {
      onSuccess: (res) => {
        toast({ title: "Welcome back", description: "Successfully logged in." });
        if (res.user.role === 'doll') setLocation("/dashboard/doll");
        else if (res.user.role === 'member') setLocation("/browse");
        else if (res.user.role === 'admin') setLocation("/admin");
      },
      onError: (err) => {
        toast({ title: "Login failed", description: "Invalid credentials.", variant: "destructive" });
      }
    });
  };

  return (
    <Layout>
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
          <h1 className="text-3xl font-serif text-white mb-6 text-center">Log In to the Lounge</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="bg-background/50 border-white/10 text-white focus-visible:ring-primary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="bg-background/50 border-white/10 text-white focus-visible:ring-primary"
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              disabled={login.isPending}
            >
              {login.isPending ? "Entering..." : "Enter"}
            </Button>
          </form>
          <div className="mt-6 text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link href={PROFILE_ENTRY_PATH} className="text-primary hover:underline">Create Free Profile</Link>
            {" "}or{" "}
            <Link href="/signup/doll" className="text-primary hover:underline">Apply as a Buddy</Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
