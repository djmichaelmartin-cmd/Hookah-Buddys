import { useState, useRef } from "react";
import { getErrorMessage } from "@/lib/error";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Store, Upload } from "lucide-react";
import { uploadImage } from "@/lib/uploadImage";
import {  
  useUpdateBusinessSettings, 
  getGetBusinessByHandleQueryKey, 
  BusinessSettingsUpdate
, BusinessDetail } from "@workspace/api-client-react";

export function SettingsForm({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const canManageLocation =
    business.viewerRole === "owner" || business.viewerRole === "admin";

  const [formData, setFormData] = useState<Partial<BusinessSettingsUpdate>>({
    name: business.name || "",
    tagline: business.tagline || "",
    description: business.description || "",
    mission: business.mission || "",
    foundedDate: business.foundedDate || "",
    address: business.address || "",
    city: business.city || "",
    state: business.state || "",
    zip: business.zip || "",
    serviceArea: business.serviceArea || "",
    phone: business.phone || "",
    email: business.email || "",
    website: business.website || "",
    parkingInfo: business.parkingInfo || "",
    priceRange: business.priceRange || "",
    accessibility: business.accessibility || "",
    ageRequirement: business.ageRequirement || "",
    isPublished: business.isPublished !== false,
    showOwner: business.showOwner === true,
    bookingEnabled: business.bookingEnabled === true,
    bookingBufferMinutes: business.bookingBufferMinutes || 0,
    allowMentions: business.allowMentions !== false,
    mentionsRequireApproval: business.mentionsRequireApproval === true,
    socials: business.socials || {},
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);

  const updateSettings = useUpdateBusinessSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "Settings updated successfully" });
        setFormData((previous) => ({ ...previous, refreshSpotlightLocation: false }));
        queryClient.invalidateQueries({ queryKey: getGetBusinessByHandleQueryKey(business.handle) });
      },
      onError: (err: unknown) => {
        toast({ title: "Failed to update", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.website && !formData.website.startsWith('http://') && !formData.website.startsWith('https://')) {
      toast({ title: "Invalid Website", description: "Website URL must start with http:// or https://", variant: "destructive" });
      return;
    }
    
    const instagram = formData.socials?.instagram;
    if (typeof instagram === "string" && instagram && !instagram.startsWith("http://") && !instagram.startsWith("https://")) {
      toast({ title: "Invalid Instagram", description: "Instagram URL must start with http:// or https://", variant: "destructive" });
      return;
    }
    
    setIsSaving(true);
    try {
      let logoUrl = business.logoUrl || undefined;
      let coverUrl = business.coverUrl || undefined;

      if (logoFile) logoUrl = await uploadImage(logoFile);
      if (coverFile) coverUrl = await uploadImage(coverFile);

      updateSettings.mutate({
        handle: business.handle,
        data: {
          ...formData,
          logoUrl,
          coverUrl,
        }
      });
    } catch (err: unknown) {
      toast({ title: "Upload failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 bg-card border border-white/10 p-6 md:p-8 rounded-3xl animate-in fade-in">
      <div>
        <h3 className="text-xl font-bold text-white mb-6">Profile Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">Logo</label>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 bg-background border border-white/10 rounded-xl overflow-hidden flex items-center justify-center shrink-0">
                {logoFile ? <img src={URL.createObjectURL(logoFile)} className="w-full h-full object-cover" /> :
                 business.logoUrl ? <img src={business.logoUrl} className="w-full h-full object-cover" /> :
                 <Store className="w-8 h-8 text-white/20" />}
              </div>
              <Input type="file" accept="image/*" onChange={e => setLogoFile(e.target.files?.[0] || null)} className="flex-1 bg-background border-white/10 text-white/80" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">Cover Image</label>
            <div className="space-y-3">
              <div className="w-full h-20 bg-background border border-white/10 rounded-xl overflow-hidden flex items-center justify-center">
                {coverFile ? <img src={URL.createObjectURL(coverFile)} className="w-full h-full object-cover" /> :
                 business.coverUrl ? <img src={business.coverUrl} className="w-full h-full object-cover" /> :
                 <span className="text-white/20 text-xs">No cover</span>}
              </div>
              <Input type="file" accept="image/*" onChange={e => setCoverFile(e.target.files?.[0] || null)} className="w-full bg-background border-white/10 text-white/80" />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Business Name</label>
              <Input value={formData.name || ""} onChange={e => setFormData(p => ({...p, name: e.target.value}))} className="bg-background border-white/10" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Tagline</label>
              <Input value={formData.tagline || ""} onChange={e => setFormData(p => ({...p, tagline: e.target.value}))} className="bg-background border-white/10" />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">Description</label>
            <Textarea value={formData.description || ""} onChange={e => setFormData(p => ({...p, description: e.target.value}))} className="bg-background border-white/10 min-h-[100px]" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Mission</label>
              <Input value={formData.mission || ""} onChange={e => setFormData(p => ({...p, mission: e.target.value}))} className="bg-background border-white/10" />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Founded Date (YYYY-MM-DD)</label>
              <Input value={formData.foundedDate || ""} onChange={e => setFormData(p => ({...p, foundedDate: e.target.value}))} className="bg-background border-white/10" />
            </div>
          </div>

          <div className="pt-4 border-t border-white/10">
            <h4 className="text-lg font-bold text-white mb-4">Location & Contact</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-white/80 mb-2">Address</label>
                <Input value={formData.address || ""} onChange={e => setFormData(p => ({...p, address: e.target.value}))} className="bg-background border-white/10" disabled={!canManageLocation} />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">City</label>
                <Input value={formData.city || ""} onChange={e => setFormData(p => ({...p, city: e.target.value}))} className="bg-background border-white/10" disabled={!canManageLocation} />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">State</label>
                <Input value={formData.state || ""} onChange={e => setFormData(p => ({...p, state: e.target.value}))} className="bg-background border-white/10" disabled={!canManageLocation} />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Zip</label>
                <Input value={formData.zip || ""} onChange={e => setFormData(p => ({...p, zip: e.target.value}))} className="bg-background border-white/10" disabled={!canManageLocation} />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Service Area</label>
                <Input value={formData.serviceArea || ""} onChange={e => setFormData(p => ({...p, serviceArea: e.target.value}))} className="bg-background border-white/10" />
              </div>
              {canManageLocation && (
                <div className="md:col-span-2 flex items-start gap-3 rounded-xl border border-white/10 bg-background p-4">
                  <Checkbox
                    id="refreshSpotlightLocation"
                    checked={formData.refreshSpotlightLocation === true}
                    onCheckedChange={(checked) =>
                      setFormData((previous) => ({
                        ...previous,
                        refreshSpotlightLocation: checked === true,
                      }))
                    }
                  />
                  <div>
                    <label
                      htmlFor="refreshSpotlightLocation"
                      className="block text-sm font-medium text-white"
                    >
                      Refresh Local Spotlight location
                    </label>
                    <p className="mt-1 text-xs text-white/50">
                      Recheck this address privately when you save. Coordinates stay
                      on the server and are never added to this page.
                    </p>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Phone</label>
                <Input value={formData.phone || ""} onChange={e => setFormData(p => ({...p, phone: e.target.value}))} className="bg-background border-white/10" />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Email</label>
                <Input type="email" value={formData.email || ""} onChange={e => setFormData(p => ({...p, email: e.target.value}))} className="bg-background border-white/10" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-white/80 mb-2">Website</label>
                <Input value={formData.website || ""} onChange={e => setFormData(p => ({...p, website: e.target.value}))} className="bg-background border-white/10" placeholder="https://" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-white/80 mb-2">Instagram URL</label>
                <Input
                  value={typeof formData.socials?.instagram === "string" ? formData.socials.instagram : ""}
                  onChange={(e) => setFormData((previous) => ({
                    ...previous,
                    socials: { ...(previous.socials ?? {}), instagram: e.target.value },
                  }))}
                  className="bg-background border-white/10"
                  placeholder="https://instagram.com/..."
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/10">
            <h4 className="text-lg font-bold text-white mb-4">Additional Info</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Parking Info</label>
                <Input value={formData.parkingInfo || ""} onChange={e => setFormData(p => ({...p, parkingInfo: e.target.value}))} className="bg-background border-white/10" />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Price Range ($ to $$$$)</label>
                <Input value={formData.priceRange || ""} onChange={e => setFormData(p => ({...p, priceRange: e.target.value}))} className="bg-background border-white/10" />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Accessibility Notes</label>
                <Input value={formData.accessibility || ""} onChange={e => setFormData(p => ({...p, accessibility: e.target.value}))} className="bg-background border-white/10" />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/80 mb-2">Age Requirement</label>
                <Input value={formData.ageRequirement || ""} onChange={e => setFormData(p => ({...p, ageRequirement: e.target.value}))} className="bg-background border-white/10" placeholder="e.g. 21+" />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/10">
            <h4 className="text-lg font-bold text-white mb-4">Bookings & Appointments</h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-background p-4 rounded-xl border border-white/10">
                <div>
                  <p className="font-medium text-white">Enable Bookings</p>
                  <p className="text-sm text-white/50">Allow customers to book appointments online</p>
                </div>
                <Switch checked={formData.bookingEnabled} onCheckedChange={c => setFormData(p => ({...p, bookingEnabled: c}))} />
              </div>
              
              {formData.bookingEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-2">Buffer Time (minutes)</label>
                    <Input type="number" min="0" value={formData.bookingBufferMinutes || 0} onChange={e => setFormData(p => ({...p, bookingBufferMinutes: parseInt(e.target.value)}))} className="bg-background border-white/10" />
                    <p className="text-xs text-white/40 mt-1">Time required between appointments</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-white/10">
            <h4 className="text-lg font-bold text-white mb-4">Interaction Settings</h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-background p-4 rounded-xl border border-white/10">
                <div>
                  <p className="font-medium text-white">Allow Mentions</p>
                  <p className="text-sm text-white/50">Allow other users to mention your business</p>
                </div>
                <Switch checked={formData.allowMentions} onCheckedChange={c => setFormData(p => ({...p, allowMentions: c}))} />
              </div>
              <div className="flex items-center justify-between bg-background p-4 rounded-xl border border-white/10">
                <div>
                  <p className="font-medium text-white">Mentions Require Approval</p>
                  <p className="text-sm text-white/50">Review mentions before they appear on your profile</p>
                </div>
                <Switch checked={formData.mentionsRequireApproval} onCheckedChange={c => setFormData(p => ({...p, mentionsRequireApproval: c}))} disabled={!formData.allowMentions} />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/10">
            <h4 className="text-lg font-bold text-white mb-4">Visibility Settings</h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-background p-4 rounded-xl border border-white/10">
                <div>
                  <p className="font-medium text-white">Publish Business Page</p>
                  <p className="text-sm text-white/60">Make your page visible to the public</p>
                </div>
                <Switch 
                  checked={formData.isPublished} 
                  onCheckedChange={c => setFormData(p => ({...p, isPublished: c}))} 
                />
              </div>
              <div className="flex items-center justify-between bg-background p-4 rounded-xl border border-white/10">
                <div>
                  <p className="font-medium text-white">Show Owner Profile</p>
                  <p className="text-sm text-white/60">Display your personal profile link on the business page</p>
                </div>
                <Switch 
                  checked={formData.showOwner} 
                  onCheckedChange={c => setFormData(p => ({...p, showOwner: c}))} 
                />
              </div>
            </div>
          </div>

        </div>
      </div>
      
      <div className="flex justify-end pt-4 border-t border-white/10 sticky bottom-4">
        <Button type="submit" disabled={isSaving || updateSettings.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-8 shadow-lg shadow-black/50">
          {isSaving || updateSettings.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
