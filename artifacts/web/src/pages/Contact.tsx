import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useSubmitContact } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Contact() {
  const submitContact = useSubmitContact();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [accountType, setAccountType] = useState("member");
  const [category, setCategory] = useState("support");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return;
    submitContact.mutate(
      { data: { name, email, accountType, category, message } },
      {
        onSuccess: (res) => {
          setDone(res.message || "Thanks for reaching out. We'll respond soon.");
          setName("");
          setEmail("");
          setMessage("");
        },
      },
    );
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 max-w-2xl">
        <h1 className="font-serif text-4xl text-primary mb-3">Contact Us</h1>
        <p className="text-muted-foreground mb-8">
          Questions, verification help, or report an issue? Our team replies within 24 hours.
        </p>

        {done ? (
          <div className="bg-card/60 backdrop-blur-xl border border-primary/30 rounded-2xl p-8 text-center">
            <p className="text-xl font-bold text-white mb-2">Message sent</p>
            <p className="text-muted-foreground">{done}</p>
            <Button className="mt-6" onClick={() => setDone(null)}>
              Send another
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8 space-y-5"
          >
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Account Type</Label>
                <Select value={accountType} onValueChange={setAccountType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="doll">Doll</SelectItem>
                    <SelectItem value="guest">Guest</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="support">General Support</SelectItem>
                    <SelectItem value="verification">Verification</SelectItem>
                    <SelectItem value="billing">Billing</SelectItem>
                    <SelectItem value="report">Report Content</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitContact.isPending}>
              {submitContact.isPending ? "Sending..." : "Send Message"}
            </Button>
          </form>
        )}
      </div>
    </Layout>
  );
}
