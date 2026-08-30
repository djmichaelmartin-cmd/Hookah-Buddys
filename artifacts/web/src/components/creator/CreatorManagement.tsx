import { useState } from "react";
import { 
  useListCreatorAlbums, 
  getListCreatorAlbumsQueryKey,
  useUpdateCreatorAlbum,
  useUpdateCreatorRequestSettings,
  useGetCreatorRequestSettings,
  getGetCreatorRequestSettingsQueryKey,
  useListCustomRequests,
  getListCustomRequestsQueryKey,
  useAcceptCustomRequest,
  useDeclineCustomRequest,
  useCompleteCustomRequest,
  useDisputeCustomRequest,
  useCancelCustomRequest,
  type CreatorAlbum,
  type CustomContentRequest
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Image as ImageIcon, Settings2, Video, DollarSign, Clock, CheckCircle2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ManageAlbumMediaDialog } from "./ManageAlbumMediaDialog";
import { DeliverRequestDialog } from "./DeliverRequestDialog";

export function CreatorAlbumsManager({ creatorUserId }: { creatorUserId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: albums, isLoading } = useListCreatorAlbums(creatorUserId, {
    query: { enabled: !!creatorUserId, queryKey: getListCreatorAlbumsQueryKey(creatorUserId) }
  });
  
  const [activeAlbum, setActiveAlbum] = useState<CreatorAlbum | null>(null);
  const updateAlbum = useUpdateCreatorAlbum({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCreatorAlbumsQueryKey(creatorUserId),
        });
      },
      onError: () =>
        toast({
          title: "Album not updated",
          description: "Please try again.",
          variant: "destructive",
        }),
    },
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading albums...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-serif text-white">Your Albums</h3>
          <p className="text-sm text-muted-foreground">Manage your Free Album, Cool Album, and Smokin Hot Album.</p>
        </div>
      </div>

      {!albums || albums.length === 0 ? (
        <div className="bg-card/30 border border-white/5 rounded-xl p-8 text-center">
          <ImageIcon className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-muted-foreground">You don't have any albums set up yet.</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Create your primary tiers to start offering bundled content.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {albums.map(album => (
            <div key={album.id} className="bg-card/50 border border-white/10 rounded-xl p-5">
              <h4 className="font-semibold text-white">
                {album.albumType === "free_preview"
                  ? "Free Album"
                  : album.albumType === "cloud_vibes"
                    ? "Cool Album"
                    : "Smokin Hot Album"}
              </h4>
              <p className="text-xs text-muted-foreground mb-4">
                {album.albumType === "free_preview"
                  ? "Free photos"
                  : "May include both photos and videos"}
              </p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                <ImageIcon className="w-4 h-4" />
                {album.media?.length || 0} items
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-white/10 hover:bg-white/5"
                  onClick={() => setActiveAlbum(album)}
                  data-testid={`button-manage-album-${album.albumType}`}
                >
                  Manage Media
                </Button>
                <Button
                  variant={album.isActive ? "outline" : "default"}
                  size="sm"
                  onClick={() =>
                    updateAlbum.mutate({
                      albumId: album.id,
                      data: { isActive: !album.isActive },
                    })
                  }
                  disabled={updateAlbum.isPending}
                  data-testid={`button-toggle-album-${album.albumType}`}
                >
                  {album.isActive ? "Pause" : "Activate"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <ManageAlbumMediaDialog 
        album={activeAlbum} 
        open={!!activeAlbum} 
        onOpenChange={(open) => !open && setActiveAlbum(null)} 
      />
    </div>
  );
}

export function CreatorRequestsManager({ creatorUserId }: { creatorUserId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: settings, isLoading: loadingSettings } = useGetCreatorRequestSettings({
    query: { enabled: !!creatorUserId, queryKey: getGetCreatorRequestSettingsQueryKey() }
  });
  
  const updateSettings = useUpdateCreatorRequestSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "Settings updated", description: "Your request settings have been saved." });
        queryClient.invalidateQueries({ queryKey: getGetCreatorRequestSettingsQueryKey() });
      },
      onError: () => toast({ title: "Error", description: "Failed to update settings.", variant: "destructive" })
    }
  });

  const { data: requests, isLoading: loadingRequests } = useListCustomRequests({
    query: { enabled: !!creatorUserId, queryKey: getListCustomRequestsQueryKey() }
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [formData, setFormData] = useState({
    enabled: false,
    photoPriceCredits: 50,
    videoPriceCredits: 150,
    photoVideoPriceCredits: 200,
    allowReuse: false,
    instructions: ""
  });

  const handleOpenSettings = () => {
    if (settings) {
      setFormData({
        enabled: settings.enabled,
        photoPriceCredits: settings.photoPriceCredits,
        videoPriceCredits: settings.videoPriceCredits,
        photoVideoPriceCredits: settings.photoVideoPriceCredits,
        allowReuse: settings.allowReuse,
        instructions: settings.instructions || ""
      });
    }
    setIsSettingsOpen(true);
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings.mutate({ data: formData });
    setIsSettingsOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-card/40 border border-white/10 p-5 rounded-xl">
        <div>
          <h3 className="text-lg font-serif text-white flex items-center gap-2">
            <Video className="w-5 h-5 text-primary" /> Custom Content Requests
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Status: <span className={settings?.enabled ? "text-green-400" : "text-yellow-500"}>{settings?.enabled ? "Accepting Requests" : "Not Accepting Requests"}</span>
          </p>
        </div>
        <Button variant="outline" className="border-white/20 text-white" onClick={handleOpenSettings}>
          <Settings2 className="w-4 h-4 mr-2" /> Settings
        </Button>
      </div>

      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="bg-card border-white/10">
          <DialogHeader>
            <DialogTitle className="text-xl font-serif text-white">Request Settings</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveSettings} className="space-y-4 pt-4">
            <div className="flex items-center space-x-2 bg-background/50 p-3 rounded-lg border border-white/5">
              <Checkbox id="enabled" checked={formData.enabled} onCheckedChange={c => setFormData({...formData, enabled: !!c})} />
              <Label htmlFor="enabled" className="text-white font-medium">Accept Custom Requests</Label>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Photo Price (credits)</Label>
                <Input type="number" min="0" value={formData.photoPriceCredits} onChange={e => setFormData({...formData, photoPriceCredits: parseInt(e.target.value)||0})} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Video Price (credits)</Label>
                <Input type="number" min="0" value={formData.videoPriceCredits} onChange={e => setFormData({...formData, videoPriceCredits: parseInt(e.target.value)||0})} className="bg-background/50 border-white/10" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Bundle Price (credits)</Label>
                <Input type="number" min="0" value={formData.photoVideoPriceCredits} onChange={e => setFormData({...formData, photoVideoPriceCredits: parseInt(e.target.value)||0})} className="bg-background/50 border-white/10" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Instructions for Members</Label>
              <Textarea 
                placeholder="E.g., I don't do specific outfits, please keep requests simple..."
                value={formData.instructions}
                onChange={e => setFormData({...formData, instructions: e.target.value})}
                className="bg-background/50 border-white/10 min-h-[80px]"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox id="reuse" checked={formData.allowReuse} onCheckedChange={c => setFormData({...formData, allowReuse: !!c})} />
              <Label htmlFor="reuse" className="text-sm text-muted-foreground">Allow me to reuse/resell requested content</Label>
            </div>

            <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={updateSettings.isPending}>
              {updateSettings.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <div className="space-y-4">
        <h4 className="font-medium text-white">Recent Requests</h4>
        {loadingRequests ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading requests...</div>
        ) : !requests || requests.length === 0 ? (
          <div className="bg-background/30 rounded-xl p-8 text-center border border-white/5">
            <p className="text-muted-foreground text-sm">No custom requests yet.</p>
          </div>
        ) : (
          requests.map(req => (
            <CreatorRequestCard key={req.id} request={req} />
          ))
        )}
      </div>
    </div>
  );
}

function CreatorRequestCard({ request }: { request: CustomContentRequest }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const accept = useAcceptCustomRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Request accepted!" });
        queryClient.invalidateQueries({ queryKey: getListCustomRequestsQueryKey() });
      },
      onError: () => toast({ title: "Error", description: "Failed to accept.", variant: "destructive" })
    }
  });

  const decline = useDeclineCustomRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Request declined" });
        queryClient.invalidateQueries({ queryKey: getListCustomRequestsQueryKey() });
      },
      onError: () => toast({ title: "Error", description: "Failed to decline.", variant: "destructive" })
    }
  });

  const [isDeliverOpen, setIsDeliverOpen] = useState(false);
  const [creatorAgreesReuse, setCreatorAgreesReuse] = useState(false);
  const isPending = request.status === "pending_creator_response";

  return (
    <div className="bg-card/40 border border-white/10 rounded-xl p-5 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary capitalize">
            {request.requestType.replace('custom_', '').replace('_', ' + ')}
          </span>
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> {request.priceCredits} cr
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            isPending ? 'bg-yellow-500/20 text-yellow-500' :
            request.status === 'accepted' || request.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400' :
            request.status === 'delivered' || request.status === 'completed' ? 'bg-green-500/20 text-green-400' :
            'bg-red-500/20 text-red-400'
          } capitalize`}>
            {request.status.replace('_', ' ')}
          </span>
        </div>
        <p className="text-white text-sm mt-2">{request.requestText}</p>
        
        {request.responseDeadlineAt && isPending && (
          <p className="text-xs text-yellow-500/80 mt-2 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Respond by {new Date(request.responseDeadlineAt).toLocaleString()}
          </p>
        )}
      </div>

      <div className="flex gap-2 shrink-0 w-full sm:w-auto">
        {isPending && (
          <>
            {request.customerAllowsReuse && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={creatorAgreesReuse}
                  onCheckedChange={(checked) => setCreatorAgreesReuse(Boolean(checked))}
                  data-testid={`checkbox-creator-reuse-${request.id}`}
                />
                Allow reuse
              </label>
            )}
            <Button data-testid={`button-decline-request-${request.id}`} size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10 flex-1 sm:flex-none" onClick={() => decline.mutate({ id: request.id })} disabled={decline.isPending}>
              Decline
            </Button>
            <Button
              data-testid={`button-accept-request-${request.id}`}
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground flex-1 sm:flex-none"
              onClick={() =>
                accept.mutate({
                  id: request.id,
                  data: { creatorAgreesReuse },
                })
              }
              disabled={accept.isPending}
            >
              Accept
            </Button>
          </>
        )}
        {(request.status === 'accepted' || request.status === 'in_progress') && (
          <Button size="sm" className="bg-green-500 hover:bg-green-600 text-white w-full sm:w-auto" onClick={() => setIsDeliverOpen(true)}>
            Deliver Content
          </Button>
        )}
      </div>
      <DeliverRequestDialog 
        request={request}
        open={isDeliverOpen}
        onOpenChange={setIsDeliverOpen}
      />
    </div>
  );
}

export function MemberRequestsManager() {
  const { data: requests, isLoading } = useListCustomRequests({
    query: { queryKey: getListCustomRequestsQueryKey() }
  });

  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Loading your requests...</div>;

  if (!requests || requests.length === 0) {
    return (
      <div className="bg-card/40 border border-white/5 rounded-xl p-8 text-center">
        <p className="text-muted-foreground">You haven't made any custom requests yet.</p>
        <p className="text-sm mt-2 text-muted-foreground/70">Visit a Creator's profile to request personalized photos or videos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {requests.map(req => (
        <MemberRequestCard key={req.id} request={req} />
      ))}
    </div>
  );
}

function MemberRequestCard({ request }: { request: CustomContentRequest }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const complete = useCompleteCustomRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Request completed!" });
        queryClient.invalidateQueries({ queryKey: getListCustomRequestsQueryKey() });
      },
      onError: () => toast({ title: "Error", description: "Failed to complete.", variant: "destructive" })
    }
  });
  const cancel = useCancelCustomRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Request cancelled", description: "Your held credits were returned." });
        queryClient.invalidateQueries({ queryKey: getListCustomRequestsQueryKey() });
      },
      onError: () => toast({ title: "Request not cancelled", variant: "destructive" }),
    },
  });
  const dispute = useDisputeCustomRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Dispute submitted", description: "An admin can now review this request." });
        queryClient.invalidateQueries({ queryKey: getListCustomRequestsQueryKey() });
      },
      onError: () => toast({ title: "Dispute not submitted", variant: "destructive" }),
    },
  });

  const openDispute = () => {
    const reason = window.prompt("Tell us what went wrong with this custom request:");
    if (reason?.trim()) {
      dispute.mutate({ id: request.id, data: { reason: reason.trim() } });
    }
  };
  const isPending = request.status === "pending_creator_response";

  return (
    <div className="bg-card/40 border border-white/10 rounded-xl p-5 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary capitalize">
            {request.requestType.replace('custom_', '').replace('_', ' + ')}
          </span>
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> {request.priceCredits} cr
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            isPending ? 'bg-yellow-500/20 text-yellow-500' :
            request.status === 'accepted' || request.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400' :
            request.status === 'delivered' || request.status === 'completed' ? 'bg-green-500/20 text-green-400' :
            'bg-red-500/20 text-red-400'
          } capitalize`}>
            {request.status.replace('_', ' ')}
          </span>
        </div>
        <p className="text-white text-sm mt-2">{request.requestText}</p>
      </div>
      <div className="flex gap-2 shrink-0 w-full sm:w-auto">
        {isPending && (
          <Button
            data-testid={`button-cancel-request-${request.id}`}
            size="sm"
            variant="outline"
            onClick={() => cancel.mutate({ id: request.id })}
            disabled={cancel.isPending}
          >
            Cancel
          </Button>
        )}
        {request.status === 'delivered' && (
          <>
            <Button
              data-testid={`button-dispute-request-${request.id}`}
              size="sm"
              variant="outline"
              onClick={openDispute}
              disabled={dispute.isPending}
            >
              Report a problem
            </Button>
            <Button data-testid={`button-complete-request-${request.id}`} size="sm" className="bg-green-500 hover:bg-green-600 text-white w-full sm:w-auto" onClick={() => complete.mutate({ id: request.id })} disabled={complete.isPending}>
              Mark Complete
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
