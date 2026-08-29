import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { useSubmitBusinessCustomerMedia } from "@workspace/api-client-react";
import { uploadImage, uploadVideo } from "@/lib/uploadImage";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Upload } from "lucide-react";

export function CustomerMediaUpload({ businessHandle, kind, onRequireAuth }: { businessHandle: string, kind: 'photo' | 'video' | 'reel', onRequireAuth: (cb: () => void) => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const mediaLabel = kind === "reel" ? "Spark" : kind;

  const submitMedia = useSubmitBusinessCustomerMedia({
    mutation: {
      onSuccess: () => {
        toast({ title: "Media submitted", description: "Your media is pending approval by the business." });
        setOpen(false);
        setFile(null);
        setCaption("");
      },
      onError: (err: unknown) => {
        toast({ title: "Failed to submit", description: getErrorMessage(err) || "An error occurred", variant: "destructive" });
      }
    }
  });

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      onRequireAuth(() => setOpen(true));
    } else {
      setOpen(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    try {
      let mediaUrl = "";
      let posterUrl: string | undefined = undefined;

      if (kind === 'video' || kind === 'reel') {
        const result = await uploadVideo(file);
        mediaUrl = result.url;
        posterUrl = result.posterUrl;
      } else {
        mediaUrl = await uploadImage(file);
      }

      await submitMedia.mutateAsync({
        handle: businessHandle,
        data: {
          kind,
          mediaUrl,
          caption
        }
      });
    } catch (err: unknown) {
      toast({ title: "Upload failed", description: getErrorMessage(err) || "An error occurred", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-white/10 bg-background/50 hover:bg-white/5 text-white gap-2">
          <Upload className="w-4 h-4" />
          Submit {mediaLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="capitalize">Submit {mediaLabel}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm text-white/80">File</label>
            <Input 
              type="file" 
              accept={kind === 'photo' ? "image/*" : "video/*"}
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="bg-background border-white/10"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-white/80">Caption (Optional)</label>
            <Textarea 
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Add a caption..."
              className="bg-background border-white/10 resize-none h-24"
            />
          </div>

          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={!file || isUploading || submitMedia.isPending} className="bg-primary text-primary-foreground gap-2">
              {isUploading || submitMedia.isPending ? "Submitting..." : <><Upload className="w-4 h-4"/> Submit</>}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}