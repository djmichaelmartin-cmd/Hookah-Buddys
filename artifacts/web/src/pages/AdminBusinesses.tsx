import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { 
  useListAdminBusinesses, 
  useModerateBusiness,
  useDeleteAdminBusiness,
  getListAdminBusinessesQueryKey,
  BusinessModerationInputAction,
  BusinessModerationInput,
  BusinessSummary,
  AdminBusinessSummary,
  ListAdminBusinessesVerificationStatus
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, XCircle, MoreVertical, ShieldAlert, Award, Star, ArrowRightLeft, Tag, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminReports } from "@/components/admin/AdminReports";

export default function AdminBusinesses() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [verificationFilter, setVerificationFilter] = useState<string>("all");
  const [featuredFilter, setFeaturedFilter] = useState<string>("all");
  const [spotlightFilter, setSpotlightFilter] = useState<string>("all");
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

  const [selectedBusiness, setSelectedBusiness] = useState<AdminBusinessSummary | null>(null);
  const [modAction, setModAction] = useState<BusinessModerationInputAction | null>(null);
  const [modReason, setModReason] = useState("");
  const [modExtra, setModExtra] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminBusinessSummary | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const moderateBusiness = useModerateBusiness({
    mutation: {
      onSuccess: () => {
        toast({ title: "Business moderated successfully" });
        queryClient.invalidateQueries({ queryKey: getListAdminBusinessesQueryKey() });
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

  const deleteBusiness = useDeleteAdminBusiness({
    mutation: {
      onSuccess: (result) => {
        toast({
          title: "Business permanently deleted",
          description: result.objectCleanupFailureCount > 0
            ? `@${result.handle} was deleted and the handle is available. ${result.objectCleanupFailureCount} file could not be cleaned up automatically.`
            : `@${result.handle} and its owned content were deleted. The handle is now available.`,
        });
        queryClient.invalidateQueries({ queryKey: getListAdminBusinessesQueryKey() });
        setDeleteTarget(null);
        setDeleteConfirmation("");
      },
      onError: (err: unknown) => {
        toast({
          title: "Business was not deleted",
          description: getErrorMessage(err) || "The deletion failed and no changes were committed.",
          variant: "destructive",
        });
      },
    },
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

  const openModDialog = (business: AdminBusinessSummary, action: BusinessModerationInputAction | 'spotlight_enable' | 'spotlight_disable') => {
    setSelectedBusiness(business);
    setModAction(action as BusinessModerationInputAction);
    setModReason("");
    setModExtra("");
  };

  const openDeleteDialog = (business: AdminBusinessSummary) => {
    setDeleteTarget(business);
    setDeleteConfirmation("");
  };

  const handleDelete = () => {
    if (!deleteTarget || deleteConfirmation.trim().toLowerCase() !== deleteTarget.handle.toLowerCase()) return;
    deleteBusiness.mutate({
      handle: deleteTarget.handle,
      data: { confirmHandle: deleteConfirmation.trim() },
    });
  };

  const businessList = (businessesResponse || []).filter((b) => {
    if (spotlightFilter === 'eligible' && !b.eligibleForLoungeSpotlight) return false;
    if (spotlightFilter === 'ineligible' && b.eligibleForLoungeSpotlight) return false;
    return true;
  });

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
            <Select value={spotlightFilter} onValueChange={setSpotlightFilter}>
              <SelectTrigger className="bg-background border-white/10 w-[140px]" data-testid="filter-spotlight">
                <SelectValue placeholder="Spotlight" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Spotlight</SelectItem>
                <SelectItem value="eligible">Eligible</SelectItem>
                <SelectItem value="ineligible">Ineligible</SelectItem>
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

          <div className="bg-card border border-white/10 rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap min-w-[800px]">
              <thead className="bg-background/50 text-white/50 uppercase text-xs">
                <tr>
                  <th className="px-6 py-4 font-medium">Business</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium">Spotlight</th>
                  <th className="px-6 py-4 font-medium">Badges/Flags</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {businessList.map((business: AdminBusinessSummary) => (
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
                      <div className="flex flex-col gap-1 text-xs">
                        <div className="flex items-center gap-1.5">
                          {business.eligibleForLoungeSpotlight ? (
                            <span className="text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3"/> Eligible</span>
                          ) : (
                            <span className="text-muted-foreground flex items-center gap-1"><XCircle className="w-3 h-3"/> Ineligible</span>
                          )}
                        </div>
                        <div className="text-muted-foreground flex items-center gap-2">
                          <span className={business.hasUsableSpotlightLocation ? "text-white/80" : "text-red-400"}>
                            Location
                          </span>
                          <span className={business.hasUsableSpotlightRating ? "text-white/80" : "text-red-400"}>
                            Rating
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          Avg: {business.averageRating?.toFixed(1) || '0.0'} ({business.reviewCount})
                          • Wt: {business.spotlightWeightedRating?.toFixed(1) || '0.0'}
                        </div>
                      </div>
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
                          ) : business.status === 'draft' ? (
                            <DropdownMenuItem
                              onClick={() => openModDialog(business, 'reinstate')}
                              className="text-green-400"
                              data-testid={`menu-activate-business-${business.handle}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-2" /> Activate
                            </DropdownMenuItem>
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
                          {business.eligibleForLoungeSpotlight ? (
                            <DropdownMenuItem onClick={() => openModDialog(business, 'spotlight_disable')} data-testid={`menu-spotlight-disable-${business.handle}`}>Disable Spotlight</DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => openModDialog(business, 'spotlight_enable')} className="text-[#D6B56D]" data-testid={`menu-spotlight-enable-${business.handle}`}><Star className="w-4 h-4 mr-2"/> Enable Spotlight</DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => openModDialog(business, 'feature')}><Award className="w-4 h-4 mr-2 text-blue-400"/> Feature</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'unfeature')}>Un-feature</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'sponsor')}><Award className="w-4 h-4 mr-2 text-purple-400"/> Sponsor</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'unsponsor')}>Un-sponsor</DropdownMenuItem>
                          
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>Management</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'badge_grant')}><Award className="w-4 h-4 mr-2"/> Grant Badge</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'badge_revoke')} className="text-red-400"><XCircle className="w-4 h-4 mr-2"/> Revoke Badge</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'set_category')}><Tag className="w-4 h-4 mr-2"/> Change Category</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openModDialog(business, 'transfer_owner')} className="text-orange-400"><ArrowRightLeft className="w-4 h-4 mr-2"/> Transfer Owner</DropdownMenuItem>
                           <DropdownMenuSeparator />
                           <DropdownMenuItem
                             onClick={() => openDeleteDialog(business)}
                             className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
                             data-testid={`menu-delete-business-${business.handle}`}
                           >
                             <Trash2 className="w-4 h-4 mr-2" /> Delete Business
                           </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {businessList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-white/50">
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
              {modAction === "reinstate" && selectedBusiness?.status === "draft"
                ? "Activate"
                : modAction?.replace(/_/g, ' ')}{" "}
              — {selectedBusiness?.name}
            </DialogTitle>
            <DialogDescription>
              Review and confirm this business administration action.
            </DialogDescription>
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

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleteBusiness.isPending) {
            setDeleteTarget(null);
            setDeleteConfirmation("");
          }
        }}
      >
        <DialogContent
          className="bg-card border-red-500/30 text-white sm:max-w-md"
          data-testid="dialog-delete-business"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <Trash2 className="h-5 w-5" />
              Permanently delete {deleteTarget?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100">
              This cannot be undone. The Business Page, its posts, media, events,
              messages, reviews, team access, verification records, and other
              business-owned activity will be permanently removed. The owner&apos;s
              member account will not be deleted.
            </div>

            <div className="space-y-2">
              <label htmlFor="delete-business-confirmation" className="text-sm text-white/80">
                Type <span className="font-mono font-semibold text-white">{deleteTarget?.handle}</span> to confirm
              </label>
              <Input
                id="delete-business-confirmation"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={deleteTarget?.handle ?? ""}
                className="bg-background border-red-500/30"
                autoComplete="off"
                disabled={deleteBusiness.isPending}
                data-testid="input-delete-business-confirmation"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteConfirmation("");
              }}
              disabled={deleteBusiness.isPending}
              className="text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={
                deleteBusiness.isPending ||
                !deleteTarget ||
                deleteConfirmation.trim().toLowerCase() !== deleteTarget.handle.toLowerCase()
              }
              className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
              data-testid="button-confirm-delete-business"
            >
              {deleteBusiness.isPending ? "Deleting..." : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
