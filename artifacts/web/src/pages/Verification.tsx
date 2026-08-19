import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useGetMyVerification, useSubmitVerification, getGetMyVerificationQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";

export default function Verification() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: verificationStatus } = useGetMyVerification();
  const submitVerification = useSubmitVerification();

  const [formData, setFormData] = useState({
    governmentIdUrl: "",
    selfieUrl: "",
    hookahPhotoUrl: "",
    hookahVideoUrl: ""
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.id]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitVerification.mutate({ data: formData }, {
      onSuccess: () => {
        toast({ title: "Verification Submitted", description: "Your documents are under review." });
        queryClient.invalidateQueries({ queryKey: getGetMyVerificationQueryKey() });
      },
      onError: () => {
        toast({ title: "Submission Failed", description: "Please check your inputs.", variant: "destructive" });
      }
    });
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <h1 className="text-3xl font-serif text-white mb-8 text-center">Buddy Verification</h1>

        <div className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-[0_0_40px_rgba(24,119,242,0.1)] mb-8 text-center">
          <h2 className="text-lg font-medium text-white mb-4">Current Status</h2>

          {verificationStatus?.status === 'approved' && (
            <div className="flex flex-col items-center">
              <ShieldCheck className="w-16 h-16 text-primary mb-4" />
              <p className="text-xl font-bold text-primary">Verified</p>
              <p className="text-muted-foreground mt-2">You have full access to all Buddy features.</p>
            </div>
          )}

          {verificationStatus?.status === 'pending' && (
            <div className="flex flex-col items-center">
              <ShieldAlert className="w-16 h-16 text-yellow-500 mb-4" />
              <p className="text-xl font-bold text-yellow-500">Pending Review</p>
              <p className="text-muted-foreground mt-2">Our team is reviewing your documents. Please allow up to 48 hours.</p>
            </div>
          )}

          {verificationStatus?.status === 'rejected' && (
            <div className="flex flex-col items-center">
              <ShieldX className="w-16 h-16 text-destructive mb-4" />
              <p className="text-xl font-bold text-destructive">Verification Rejected</p>
              <p className="text-muted-foreground mt-2">{verificationStatus.notes || "Please resubmit your documents."}</p>
            </div>
          )}

          {(!verificationStatus || verificationStatus.status === ('unverified' as typeof verificationStatus.status)) && (
            <div className="flex flex-col items-center">
              <ShieldAlert className="w-16 h-16 text-muted-foreground mb-4" />
              <p className="text-xl font-bold text-white">Not Verified</p>
              <p className="text-muted-foreground mt-2">You must complete verification to activate your profile.</p>
            </div>
          )}
        </div>

        {(!verificationStatus || verificationStatus.status === ('unverified' as typeof verificationStatus.status) || verificationStatus.status === 'rejected') && (
          <div className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
            <h3 className="text-xl font-serif text-white mb-4">Submit Documents</h3>
            <p className="text-sm text-muted-foreground mb-6">

              Only approved Buddies receive the Verified Badge and can earn on HookahBuddys.com. All URLs are placeholders for actual file uploads in this demo.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="governmentIdUrl">Government ID (URL)</Label>
                <Input id="governmentIdUrl" required value={formData.governmentIdUrl} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="selfieUrl">Selfie matching ID (URL)</Label>
                <Input id="selfieUrl" required value={formData.selfieUrl} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hookahPhotoUrl">Photo posing with Hookah (URL)</Label>
                <Input id="hookahPhotoUrl" required value={formData.hookahPhotoUrl} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hookahVideoUrl">Short Video with Hookah (URL)</Label>
                <Input id="hookahVideoUrl" required value={formData.hookahVideoUrl} onChange={handleChange} className="bg-background/50 border-white/10" />
              </div>

              <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold mt-6" disabled={submitVerification.isPending}>
                {submitVerification.isPending ? "Submitting..." : "Submit for Verification"}
              </Button>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
