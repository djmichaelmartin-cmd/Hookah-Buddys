import { useState } from "react";
import { 
  useGetCreatorRequestAvailability,
  getGetCreatorRequestAvailabilityQueryKey,
  useCreateCustomRequest,
  type CustomContentRequestInputRequestType
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Video, Camera, FileVideo, DollarSign } from "lucide-react";

export function CustomRequestDialog({ 
  creatorUserId, 
  open, 
  onOpenChange,
  onCreditError
}: { 
  creatorUserId: number; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
  onCreditError: (err: unknown) => void;
}) {
  const { toast } = useToast();
  
  const { data: settings, isLoading } = useGetCreatorRequestAvailability(creatorUserId, {
    query: {
      enabled: open && !!creatorUserId,
      queryKey: getGetCreatorRequestAvailabilityQueryKey(creatorUserId),
    }
  });

  const createRequest = useCreateCustomRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Request sent!", description: "The creator has been notified." });
        onOpenChange(false);
        setRequestText("");
      },
      onError: onCreditError
    }
  });

  const [requestType, setRequestType] = useState<CustomContentRequestInputRequestType>('custom_photo');
  const [requestText, setRequestText] = useState("");
  const [allowReuse, setAllowReuse] = useState(false);

  const getPrice = () => {
    if (!settings) return 0;
    switch (requestType) {
      case 'custom_photo': return settings.photoPriceCredits;
      case 'custom_video': return settings.videoPriceCredits;
      case 'custom_photo_video': return settings.photoVideoPriceCredits;
      default: return 0;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestText.trim()) return;
    
    createRequest.mutate({
      data: {
        creatorUserId,
        requestType,
        requestText,
        idempotencyKey: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        allowReuse
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-white/10 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif text-white flex items-center gap-2">
            <Video className="w-5 h-5 text-primary" /> Request Custom Content
          </DialogTitle>
          <DialogDescription>
            Ask for a personalized photo or video. The Creator has two hours to accept and two hours to deliver after accepting.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Checking availability...</div>
        ) : !settings?.enabled || !settings.onlineEligible ? (
          <div className="py-8 text-center bg-background/30 rounded-lg border border-white/5">
            <p className="text-muted-foreground">This Creator is not online and accepting custom requests right now.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6 pt-4">
            {settings.instructions && (
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                <h4 className="text-xs font-semibold text-primary mb-1 uppercase tracking-wider">Creator Instructions</h4>
                <p className="text-sm text-primary/80">{settings.instructions}</p>
              </div>
            )}

            <div className="space-y-3">
              <Label className="text-white font-medium">Select Type</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setRequestType('custom_photo')}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-colors ${requestType === 'custom_photo' ? 'bg-primary/10 border-primary' : 'bg-background/50 border-white/10 hover:border-white/20'}`}
                >
                  <Camera className={`w-6 h-6 mb-2 ${requestType === 'custom_photo' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="font-medium text-sm text-white">Photo</span>
                  <span className="text-xs text-muted-foreground mt-1">{settings.photoPriceCredits} cr</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRequestType('custom_video')}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-colors ${requestType === 'custom_video' ? 'bg-primary/10 border-primary' : 'bg-background/50 border-white/10 hover:border-white/20'}`}
                >
                  <Video className={`w-6 h-6 mb-2 ${requestType === 'custom_video' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="font-medium text-sm text-white">Video</span>
                  <span className="text-xs text-muted-foreground mt-1">{settings.videoPriceCredits} cr</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRequestType('custom_photo_video')}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-colors ${requestType === 'custom_photo_video' ? 'bg-primary/10 border-primary' : 'bg-background/50 border-white/10 hover:border-white/20'}`}
                >
                  <FileVideo className={`w-6 h-6 mb-2 ${requestType === 'custom_photo_video' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="font-medium text-sm text-white">Bundle</span>
                  <span className="text-xs text-muted-foreground mt-1">{settings.photoVideoPriceCredits} cr</span>
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-white font-medium">Your Request</Label>
              <Textarea 
                required
                placeholder="Describe exactly what you want..."
                value={requestText}
                onChange={e => setRequestText(e.target.value)}
                className="bg-background/50 border-white/10 min-h-[100px]"
              />
            </div>

            <div className="flex items-start space-x-3 bg-background/30 p-3 rounded-lg border border-white/5">
              <Checkbox id="allowReuse" checked={allowReuse} onCheckedChange={c => setAllowReuse(!!c)} className="mt-0.5" />
              <div>
                <Label htmlFor="allowReuse" className="text-sm font-medium text-white cursor-pointer">Allow creator to resell</Label>
                <p className="text-xs text-muted-foreground mt-1">If checked, the creator can add this content to their public albums after delivering it to you.</p>
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-lg h-12"
              disabled={createRequest.isPending || !requestText.trim()}
            >
              {createRequest.isPending ? "Sending..." : `Send Request (${getPrice()} Credits)`}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}