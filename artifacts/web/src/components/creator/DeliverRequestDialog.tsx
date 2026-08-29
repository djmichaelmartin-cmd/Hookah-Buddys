import { useState } from "react";
import { 
  useUploadCreatorContentImage,
  useUploadCreatorContentVideo,
  useDeliverCustomRequest,
  getListCustomRequestsQueryKey,
  type CustomContentRequest
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UploadCloud } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function DeliverRequestDialog({ 
  request, 
  open, 
  onOpenChange 
}: { 
  request: CustomContentRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const uploadImage = useUploadCreatorContentImage();
  const uploadVideo = useUploadCreatorContentVideo();
  const deliverRequest = useDeliverCustomRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Content delivered!" });
        queryClient.invalidateQueries({ queryKey: getListCustomRequestsQueryKey() });
        onOpenChange(false);
        resetForm();
      },
      onError: (err: any) => {
        toast({ title: "Failed to deliver", description: err?.data?.error || "Unknown error", variant: "destructive" });
      }
    }
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  const resetForm = () => {
    setImageFile(null);
    setVideoFile(null);
    setMessage("");
  };

  const handleDeliver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request) return;

    setUploading(true);
    try {
      let imageObjectPath: string | undefined;
      let videoObjectPath: string | undefined;
      let videoPosterObjectPath: string | undefined;

      if (imageFile) {
        const result = await uploadImage.mutateAsync({ data: imageFile });
        imageObjectPath = result.objectPath;
      }
      if (videoFile) {
        const result = await uploadVideo.mutateAsync({ data: videoFile });
        videoObjectPath = result.objectPath;
        videoPosterObjectPath = result.posterPath;
      }

      await deliverRequest.mutateAsync({
        id: request.id,
        data: {
          imageObjectPath,
          videoObjectPath,
          videoPosterObjectPath,
          message: message || undefined,
        }
      });
      setUploading(false);
    } catch (error) {
      console.error(error);
      setUploading(false);
      toast({ title: "Delivery failed", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-white/10 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif text-white">
            Deliver Custom Content
          </DialogTitle>
        </DialogHeader>
        
        {request && (
          <form onSubmit={handleDeliver} className="space-y-6 pt-4">
            <div className="bg-background/30 p-4 rounded-lg border border-white/5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-1">Member Request</p>
              <p className="text-sm text-white">{request.requestText}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {request.requestType !== "custom_video" && (
                <div className="bg-background/40 border border-white/10 border-dashed rounded-xl p-5 text-center flex flex-col items-center">
                  <UploadCloud className="w-7 h-7 text-muted-foreground mb-2" />
                  <p className="mb-3 text-sm text-white">Final photo</p>
                  <Label htmlFor={`deliver-image-${request.id}`} className="cursor-pointer">
                    <div className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md inline-flex items-center text-sm font-medium">
                      {imageFile?.name ?? "Choose Photo"}
                    </div>
                    <input
                      id={`deliver-image-${request.id}`}
                      data-testid={`input-delivery-image-${request.id}`}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => setImageFile(e.target.files?.[0] || null)}
                    />
                  </Label>
                </div>
              )}
              {request.requestType !== "custom_photo" && (
                <div className="bg-background/40 border border-white/10 border-dashed rounded-xl p-5 text-center flex flex-col items-center">
                  <UploadCloud className="w-7 h-7 text-muted-foreground mb-2" />
                  <p className="mb-3 text-sm text-white">Final video</p>
                  <Label htmlFor={`deliver-video-${request.id}`} className="cursor-pointer">
                    <div className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md inline-flex items-center text-sm font-medium">
                      {videoFile?.name ?? "Choose Video"}
                    </div>
                    <input
                      id={`deliver-video-${request.id}`}
                      data-testid={`input-delivery-video-${request.id}`}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={e => setVideoFile(e.target.files?.[0] || null)}
                    />
                  </Label>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Message to member (optional)</Label>
              <Textarea 
                placeholder="Hope you like it!"
                value={message}
                onChange={e => setMessage(e.target.value)}
                className="bg-background/50 border-white/10"
              />
            </div>
            
            {request.customerAllowsReuse && request.creatorAgreesReuse && (
              <p className="rounded-lg border border-white/5 bg-background/30 p-3 text-xs text-muted-foreground">
                Both sides agreed this delivery may be reused in public Creator content.
              </p>
            )}

            <Button 
              type="submit" 
              className="w-full bg-green-500 hover:bg-green-600 text-white" 
              data-testid={`button-deliver-request-${request.id}`}
              disabled={
                (request.requestType !== "custom_video" && !imageFile) ||
                (request.requestType !== "custom_photo" && !videoFile) ||
                uploading ||
                uploadImage.isPending ||
                uploadVideo.isPending ||
                deliverRequest.isPending
              }
            >
              {uploading || deliverRequest.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading & Delivering...</>
              ) : (
                "Deliver Content"
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}