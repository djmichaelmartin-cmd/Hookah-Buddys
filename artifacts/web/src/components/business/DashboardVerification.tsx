import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import {  
  useGetBusinessVerification,
  useSubmitBusinessVerification,
  useUploadBusinessVerificationDocument,
  getGetBusinessVerificationQueryKey
, BusinessDetail } from "@workspace/api-client-react";

export function DashboardVerification({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [legalName, setLegalName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);

  const { data: verification, isLoading } = useGetBusinessVerification(business.handle, {
    query: { enabled: !!business.handle, queryKey: getGetBusinessVerificationQueryKey(business.handle) }
  });

  const uploadDoc = useUploadBusinessVerificationDocument();

  const submitVerification = useSubmitBusinessVerification({
    mutation: {
      onSuccess: () => {
        toast({ title: "Verification submitted!" });
        queryClient.invalidateQueries({ queryKey: getGetBusinessVerificationQueryKey(business.handle) });
      },
      onError: (err: unknown) => toast({ title: "Failed to submit", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile) {
      toast({ title: "Document required", variant: "destructive" });
      return;
    }

    try {
      const uploadResult = await uploadDoc.mutateAsync({
        handle: business.handle,
        data: docFile
      });
      
      submitVerification.mutate({
        handle: business.handle,
        data: {
          legalName,
          contactEmail,
          contactPhone,
          notes,
          documentRefs: [uploadResult.documentRef]
        }
      });
    } catch (err: unknown) {
      toast({ title: "Upload failed", description: getErrorMessage(err), variant: "destructive" });
    }
  };

  if (isLoading) return <div className="p-12 text-center text-white/50">Loading verification status...</div>;

  const status = verification?.verificationStatus || "unverified";

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Shield className="w-6 h-6 text-[#D6B56D]" />
        <h3 className="text-2xl font-bold text-white">Business Verification</h3>
      </div>

      <div className={`p-6 rounded-2xl border ${
        status === 'verified' ? 'bg-green-500/10 border-green-500/30' :
        status === 'pending' ? 'bg-yellow-500/10 border-yellow-500/30' :
        status === 'rejected' ? 'bg-red-500/10 border-red-500/30' :
        'bg-card border-white/10'
      }`}>
        <div className="flex items-center gap-3 mb-2">
          {status === 'verified' ? <ShieldCheck className="w-6 h-6 text-green-400" /> : <ShieldAlert className="w-6 h-6 text-white/40" />}
          <h4 className="text-lg font-bold text-white capitalize">Status: {status}</h4>
        </div>
        <p className="text-white/70 text-sm">
          {status === 'verified' && "Your business is verified. The verified badge is displayed on your profile."}
          {status === 'pending' && "Your verification request is currently under review by our team."}
          {status === 'rejected' && "Your previous verification request was rejected. Please review our guidelines and submit again."}
          {status === 'unverified' && "Get verified to build trust with customers and unlock the verified badge."}
        </p>
      </div>

      {(status === 'unverified' || status === 'rejected') && (
        <form onSubmit={handleSubmit} className="bg-card border border-white/10 rounded-2xl p-6 md:p-8 space-y-6">
          <h4 className="font-bold text-white text-lg border-b border-white/10 pb-4">Submit for Verification</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Legal Business Name</label>
              <Input required value={legalName} onChange={e => setLegalName(e.target.value)} className="bg-background border-white/10" />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Contact Email</label>
              <Input required type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} className="bg-background border-white/10" />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Contact Phone</label>
              <Input required value={contactPhone} onChange={e => setContactPhone(e.target.value)} className="bg-background border-white/10" />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Verification Document</label>
              <Input required type="file" onChange={e => setDocFile(e.target.files?.[0] || null)} className="bg-background border-white/10 text-white/80" />
              <p className="text-xs text-white/40 mt-1">Upload a business license, utility bill, or tax document.</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-white/80 mb-2">Additional Notes</label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="bg-background border-white/10" placeholder="Any extra information for our reviewers..." />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-white/10">
            <Button type="submit" disabled={submitVerification.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-8">
              {submitVerification.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
