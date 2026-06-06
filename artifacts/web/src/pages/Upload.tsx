import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useUploadMedia, useListMyMedia, getListMyMediaQueryKey } from "@workspace/api-client-react";
import { MediaInputType } from "@workspace/api-client-react/src/generated/api.schemas";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle } from "lucide-react";

export default function Upload() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const uploadMedia = useUploadMedia();
  const { data: myMedia } = useListMyMedia();

  const [url, setUrl] = useState("");
  const [type, setType] = useState<MediaInputType>("free_photo");
  const [price, setPrice] = useState("");
  const [hookahConfirmed, setHookahConfirmed] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hookahConfirmed) {
      toast({ title: "Required", description: "You must confirm the presence of a hookah.", variant: "destructive" });
      return;
    }
    
    uploadMedia.mutate({
      data: {
        url,
        type,
        containsHookah: true,
        premium: type === 'premium_photo' || type === 'premium_video',
        price: price ? parseFloat(price) : undefined,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Uploaded Successfully", description: "Content is now pending review." });
        setUrl("");
        setPrice("");
        setHookahConfirmed(false);
        queryClient.invalidateQueries({ queryKey: getListMyMediaQueryKey() });
      },
      onError: () => {
        toast({ title: "Upload Failed", description: "Could not upload media.", variant: "destructive" });
      }
    });
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <h1 className="text-3xl font-serif text-white mb-8">Upload Content</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div>
            <div className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="url">Media URL (Placeholder for file upload)</Label>
                  <Input id="url" required value={url} onChange={e => setUrl(e.target.value)} className="bg-background/50 border-white/10" placeholder="https://..." />
                </div>
                
                <div className="space-y-2">
                  <Label>Content Type</Label>
                  <Select value={type} onValueChange={(v: MediaInputType) => setType(v)}>
                    <SelectTrigger className="bg-background/50 border-white/10">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="profile">Profile Photo</SelectItem>
                      <SelectItem value="free_photo">Free Photo Gallery</SelectItem>
                      <SelectItem value="premium_photo">Premium Photo (Paid)</SelectItem>
                      <SelectItem value="premium_video">Premium Video (Paid)</SelectItem>
                      <SelectItem value="short_video">Short Video (Free)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {(type === 'premium_photo' || type === 'premium_video') && (
                  <div className="space-y-2">
                    <Label htmlFor="price">Unlock Price ($)</Label>
                    <Input id="price" type="number" step="0.01" required value={price} onChange={e => setPrice(e.target.value)} className="bg-background/50 border-white/10" />
                  </div>
                )}

                <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-primary shrink-0" />
                  <div>
                    <h4 className="font-medium text-primary text-sm mb-1">Strict Aesthetic Rule</h4>
                    <p className="text-xs text-primary/80 mb-3">No hookah, no approval. All content must feature a visible hookah.</p>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="hookahConfirmed" checked={hookahConfirmed} onCheckedChange={(c) => setHookahConfirmed(c as boolean)} />
                      <Label htmlFor="hookahConfirmed" className="text-sm font-semibold text-white">I confirm this content includes a visible hookah.</Label>
                    </div>
                  </div>
                </div>

                <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" disabled={uploadMedia.isPending}>
                  {uploadMedia.isPending ? "Uploading..." : "Upload Content"}
                </Button>
              </form>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-serif text-white mb-4">Your Recent Uploads</h2>
            <div className="space-y-4">
              {myMedia?.slice(0, 5).map(media => (
                <div key={media.id} className="flex gap-4 bg-card/50 border border-white/10 rounded-lg p-3 items-center">
                  <div className="w-16 h-16 rounded bg-black/50 overflow-hidden shrink-0">
                    <img src={media.url} alt="" className="w-full h-full object-cover opacity-80" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-white capitalize">{media.type.replace('_', ' ')}</p>
                    <p className="text-xs text-muted-foreground capitalize">{media.status.replace('_', ' ')}</p>
                  </div>
                  {media.status === 'pending_review' && <span className="w-2 h-2 rounded-full bg-yellow-500" title="Pending"></span>}
                  {media.status === 'approved' && <span className="w-2 h-2 rounded-full bg-green-500" title="Approved"></span>}
                  {media.status === 'rejected' && <span className="w-2 h-2 rounded-full bg-red-500" title="Rejected"></span>}
                </div>
              ))}
              {(!myMedia || myMedia.length === 0) && <p className="text-muted-foreground text-sm">No uploads yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
