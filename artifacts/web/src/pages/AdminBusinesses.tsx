import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { 
  useListAdminBusinesses, 
  useModerateBusiness,
  getListAdminBusinessesQueryKey,
  BusinessModerationInputAction,
  BusinessModerationInput,
  BusinessSummary,
  ListAdminBusinessesVerificationStatus
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, XCircle, MoreVertical, ShieldAlert, Award, Star, ArrowRightLeft, Tag } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminReports } from "@/components/admin/AdminReports";

export default function AdminBusinesses() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [verificationFilter, setVerificationFilter] = useState<string>("all");
  const [featuredFilter, setFeaturedFilter] = useState<string>("all");
  const [sponsoredFilter, setSponsoredFilter] = useState<string>("all");

  const queryParams = {
    status: statusFilter !== "all" ? statusFilter : undefined,
    q: searchTerm || undefined,
    verificationStatus: verificationFilter !== "all" ? (verificationFilter as ListAdminBusinessesVerificationStatus) : undefined,
    featured: featuredFilter !== "all" ? featuredFilter === 'featured' ? "true" : "false" : undefined,
    sponsored: sponsoredFilter !== "all" ? sponsoredFilter === 'sponsored' ? "true" : "false" : undefined,
  };

  const { data: businessesResponse } = useListAdminBusinesses(queryParams, {
    query: { queryKey: getListAdminBusinessesQueryKey(queryParams) }
  });

  const [selectedBusiness, setSelectedBusiness] = useState<BusinessSummary | null>(null);
  const [modAction, setModAction] = useState<BusinessModerationInputAction | null>(null);
  const [modReason, setModReason] = useState("");
  const [modExtra, setModExtra] = useState("");

  const moderateBusiness = useModerateBusiness({
    mutation: {
      onSuccess: () => {
        toast({ title: "Business moderated successfully" });
        queryClient.invalidateQueries({ queryKey: getListAdminBusinessesQueryKey({}) }); // Invalidate all
        setModAction(null);
        setModReason("");
        setModExtra("");
        setSelectedBusiness(null);
      },
      onError: (err: unknown) => {
        toast({ title: "Failed to moderate", description: getErrorMessage(err) || "An error occurred", variant: "destructive" });
      }
    }
  });

  const handleModerate = () => {
    if (!selectedBusiness || !modAction) return;

    if (['suspend', 'warn', 'reject_verification'].includes(modAction) && !modReason) {
      toast({ title: "Reason required", description: "Please provide a reason for this action.", variant: "destructive" });
      return;
    }

    const payload: BusinessModerationInput = { action: modAction, reason: modReason || undefined };

    if (modAction === 'set_category') payload.category = modExtra;
    if (modAction === 'transfer_owner') payload.newOwnerUserId = Number(modExtra);
    if (modAction === 'badge_grant' || modAction === 'badge_revoke') payload.badge = modExtra;
    if (modAction === 'feature') payload.featuredUntil = modExtra ? new Date(modExtra).toISOString() : undefined;
    if (modAction === 'sponsor') payload.sponsoredUntil = modExtra ? new Date(modExtra).toISOString() : undefined;

    moderateBusiness.mutate({
      handle: selectedBusiness.handle,
      data: payload
    });
  };

  const openModDialog = (business: BusinessSummary, action: BusinessModerationInputAction) => {
    setSelectedBusiness(business);
    setModAction(action);
    setModReason("");
    setModExtra("");
  };

  const businessList = businessesResponse || [];

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Business Administration</h2>
      </div>

      <Tabs defaultValue="businesses" className="w-full">
        <TabsList className="bg-card border border-white/10 mb-6">
          <TabsTrigger value="businesses">Businesses</TabsTrigger>
          <TabsTrigger value="reports">Reports Queue</TabsTrigger>
        </TabsList>

        <TabsContent value="businesses" className="space-y-6">
          <div className="bg-card border border-white/10 rounded-2xl p-4 flex flex-wrap gap-4">
            <Input 
              placeholder="Search businesses..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="bg-background border-white/10 w-full md:w-64" 
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-background border-white/10 w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Select value={verificationFilter} onValueChange={setVerificationFilter}>
              <SelectTrigger className="bg-background border-white/10 w-[140px]">
                <SelectValue placeholder="Verification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Verification</SelectItem>
                <SelectItem value="verified">Verified</SelectItem>
                <SelectItem value="unverified">Unverified</SelectItem>
              </SelectContent>
            </Select>
            <Select value={featuredFilter} onValueChange={setFeaturedFilter}>
              <SelectTrigger className="bg-background border-white/10 w-[140px]">
                <SelectValue placeholder="Featured" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Featured</SelectItem>
                <SelectItem value="featured">Featured</SelectItem>
                <SelectItem value="unfeatured">Standard</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="bg-card border border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-background/50 text-white/50 uppercase text-xs">
                <tr>
                  <th className="px-6 py-4 font-medium">Business</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium">Badges/Flags</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {businessList.map((business: BusinessSummary) => (
                  <tr key={business.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-background border border-white/10 overflow-hidden shrink-0">
                          {business.logoUrl ? <img src={business.logoUrl} className="w-full h-full object-cover" /> : null}
                        </div>
                        <div>
                          <p className="font-bold text-white text-base">{business.name}</p>
                          <p className="text-white/50">@{business.handle}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        business.status === 'active' ? 'bg-green-500/20 text-green-400' :
                        business.status === 'suspended' ? 'bg-red-500/20 text-red-400' :
                        'bg-white/10 text-white/70'
                      }`}>
                        {business.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {business.badges?.map((badge: string) => (
                          <span key={badge} className="px-2 py-0.5 bg-[#D6B56D]/20 text-[#D6B56D] text-[10px] font-bold rounded uppercase">{badge}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-white/60 hover:text-white">
                            <MoreVertical className="w-5 h-5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 bg-card border-white/10">
                          <DropdownMenuLabel>Moderation</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'warn')}><ShieldAlert className="w-4 h-4 mr-2"/> Warn</DropdownMenuItem>
                          {business.status === 'suspended' ? (
                            <DropdownMenuItem onClick={() => openModDialog(business, 'reinstate')} className="text-green-400"><CheckCircle className="w-4 h-4 mr-2"/> Reinstate</DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => openModDialog(business, 'suspend')} className="text-red-400"><XCircle className="w-4 h-4 mr-2"/> Suspend</DropdownMenuItem>
                          )}
                          
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>Verification & Status</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'verify')}><CheckCircle className="w-4 h-4 mr-2 text-green-400"/> Approve Verify</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'reject_verification')}><XCircle className="w-4 h-4 mr-2 text-red-400"/> Reject Verify</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'request_verification_changes')}>Request Changes</DropdownMenuItem>
                          
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>Promotion</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'feature')}><Star className="w-4 h-4 mr-2 text-[#D6B56D]"/> Feature</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'unfeature')}>Un-feature</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'sponsor')}><Award className="w-4 h-4 mr-2 text-blue-400"/> Sponsor</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'unsponsor')}>Un-sponsor</DropdownMenuItem>
                          
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>Management</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'badge_grant')}><Award className="w-4 h-4 mr-2"/> Grant Badge</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'badge_revoke')} className="text-red-400"><XCircle className="w-4 h-4 mr-2"/> Revoke Badge</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'set_category')}><Tag className="w-4 h-4 mr-2"/> Change Category</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'transfer_owner')} className="text-orange-400"><ArrowRightLeft className="w-4 h-4 mr-2"/> Transfer Owner</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {businessList.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-white/50">
                      No businesses match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="reports" className="animate-in fade-in">
          <AdminReports />
        </TabsContent>
      </Tabs>

      <Dialog open={!!modAction} onOpenChange={(open) => !open && setModAction(null)}>
        <DialogContent className="bg-card border-white/10 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">
              {modAction?.replace(/_/g, ' ')} — {selectedBusiness?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {['suspend', 'warn', 'reject_verification', 'request_verification_changes'].includes(modAction as string) && (
              <div className="space-y-2">
                <label className="text-sm text-white/80">Reason (Required for this action)</label>
                <Textarea 
                  value={modReason} 
                  onChange={e => setModReason(e.target.value)} 
                  placeholder="Explain why this action is being taken..."
                  className="bg-background border-white/10"
                />
              </div>
            )}

            {['badge_grant', 'badge_revoke'].includes(modAction as string) && (
              <div className="space-y-2">
                <label className="text-sm text-white/80">Badge Name</label>
                <Input value={modExtra} onChange={e => setModExtra(e.target.value)} placeholder="e.g. premium" className="bg-background border-white/10" />
              </div>
            )}

            {modAction === 'set_category' && (
              <div className="space-y-2">
                <label className="text-sm text-white/80">New Category</label>
                <Input value={modExtra} onChange={e => setModExtra(e.target.value)} placeholder="e.g. Nightlife" className="bg-background border-white/10" />
              </div>
            )}

            {modAction === 'transfer_owner' && (
              <div className="space-y-2">
                <label className="text-sm text-white/80">New Owner User ID</label>
                <Input type="number" value={modExtra} onChange={e => setModExtra(e.target.value)} placeholder="e.g. 42" className="bg-background border-white/10" />
              </div>
            )}

            {['feature', 'sponsor'].includes(modAction as string) && (
              <div className="space-y-2">
                <label className="text-sm text-white/80">End Date (Optional)</label>
                <Input type="datetime-local" value={modExtra} onChange={e => setModExtra(e.target.value)} className="bg-background border-white/10 text-white" />
              </div>
            )}
            
            {['suspend', 'transfer_owner', 'reject_verification', 'badge_revoke', 'unsponsor', 'unfeature'].includes(modAction as string) && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex gap-3 text-red-400 mt-4">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <p className="text-sm">This is a destructive or significant action. Please confirm before proceeding.</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setModAction(null)} className="text-white">Cancel</Button>
            <Button 
              onClick={handleModerate} 
              disabled={moderateBusiness.isPending}
              className={`${['suspend', 'reject_verification', 'badge_revoke'].includes(modAction as string) ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-primary text-primary-foreground'}`}
            >
              {moderateBusiness.isPending ? "Processing..." : "Confirm Action"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
