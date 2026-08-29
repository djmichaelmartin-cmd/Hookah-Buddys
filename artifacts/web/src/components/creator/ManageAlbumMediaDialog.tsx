import { useState } from "react";
import { 
  useUploadCreatorContentImage,
  useUploadCreatorContentVideo,
  useAddCreatorAlbumMedia,
  useRemoveCreatorAlbumMedia,
  useUpdateCreatorAlbumMedia,
  getListCreatorAlbumsQueryKey,
  type CreatorAlbum,
  type CreatorAlbumMediaInputMediaType
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, X, Image as ImageIcon, Video, UploadCloud } from "lucide-react";
import { Label } from "@/components/ui/label";

export function ManageAlbumMediaDialog({ 
  album, 
  open, 
  onOpenChange 
}: { 
  album: CreatorAlbum | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const uploadImage = useUploadCreatorContentImage();
  const uploadVideo = useUploadCreatorContentVideo();
  
  const addMedia = useAddCreatorAlbumMedia({
    mutation: {
      onSuccess: () => {
        toast({ title: "Media added" });
        queryClient.invalidateQueries({ queryKey: getListCreatorAlbumsQueryKey(album?.creatorUserId || 0) });
        setUploading(false);
      },
      onError: (err: any) => {
        toast({ title: "Failed to add media", description: err?.data?.error || "Unknown error", variant: "destructive" });
        setUploading(false);
      }
    }
  });

  const removeMedia = useRemoveCreatorAlbumMedia({
    mutation: {
      onSuccess: () => {
        toast({ title: "Media removed" });
        queryClient.invalidateQueries({ queryKey: getListCreatorAlbumsQueryKey(album?.creatorUserId || 0) });
      },
      onError: () => toast({ title: "Failed to remove", variant: "destructive" })
    }
  });
  const updateMedia = useUpdateCreatorAlbumMedia({
    mutation: {
      onSuccess: () => {
        if (album) {
          queryClient.invalidateQueries({
            queryKey: getListCreatorAlbumsQueryKey(album.creatorUserId),
          });
        }
      },
      onError: () =>
        toast({ title: "Media order not updated", variant: "destructive" }),
    },
  });

  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!album) return;
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const isVideo = file.type.startsWith("video/");
    
    try {
      if (isVideo) {
        const res = await uploadVideo.mutateAsync({ data: file });
        await addMedia.mutateAsync({
          albumId: album.id,
          data: {
            mediaType: "video",
            objectPath: res.objectPath,
            posterObjectPath: res.posterPath
          }
        });
      } else {
        const res = await uploadImage.mutateAsync({ data: file });
        await addMedia.mutateAsync({
          albumId: album.id,
          data: {
            mediaType: "image",
            objectPath: res.objectPath
          }
        });
      }
    } catch (error) {
      console.error(error);
      setUploading(false);
      toast({ title: "Upload failed", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-white/10 sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif text-white capitalize">
            Manage {album?.albumType.replace('_', ' ')}
          </DialogTitle>
        </DialogHeader>
        
        {album && (
          <div className="space-y-6 pt-4">
            <div className="bg-background/40 border border-white/10 border-dashed rounded-xl p-8 text-center flex flex-col items-center">
              <UploadCloud className="w-8 h-8 text-muted-foreground mb-3" />
              <p className="text-sm text-white mb-4">Upload new photo or video</p>
              <Label htmlFor={`upload-${album.id}`} className="cursor-pointer">
                <div className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md inline-flex items-center text-sm font-medium">
                  {uploading || uploadImage.isPending || uploadVideo.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</>
                  ) : (
                    "Select File"
                  )}
                </div>
                <input 
                  id={`upload-${album.id}`} 
                  type="file" 
                  accept="image/*,video/*" 
                  className="hidden" 
                  disabled={uploading || uploadImage.isPending || uploadVideo.isPending}
                  onChange={handleFileChange}
                />
              </Label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {album.media?.filter(m => m.status === 'active').map((m, index, items) => (
                <div key={m.id} className="relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-black group">
                  {m.mediaType === 'video' ? (
                    <video src={m.objectPath} className="w-full h-full object-cover" />
                  ) : (
                    <img src={m.objectPath} className="w-full h-full object-cover" />
                  )}
                  <button
                    onClick={() => removeMedia.mutate({ albumId: album.id, mediaId: m.id })}
                    disabled={removeMedia.isPending}
                    className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-red-500/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      data-testid={`button-media-up-${m.id}`}
                      className="rounded bg-black/70 px-2 py-1 text-xs text-white disabled:opacity-40"
                      disabled={index === 0 || updateMedia.isPending}
                      onClick={() =>
                        updateMedia.mutate({
                          albumId: album.id,
                          mediaId: m.id,
                          data: { sortOrder: Math.max(0, (items[index - 1]?.sortOrder ?? 0) - 1) },
                        })
                      }
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      data-testid={`button-media-down-${m.id}`}
                      className="rounded bg-black/70 px-2 py-1 text-xs text-white disabled:opacity-40"
                      disabled={index === items.length - 1 || updateMedia.isPending}
                      onClick={() =>
                        updateMedia.mutate({
                          albumId: album.id,
                          mediaId: m.id,
                          data: { sortOrder: (items[index + 1]?.sortOrder ?? m.sortOrder) + 1 },
                        })
                      }
                    >
                      Down
                    </button>
                  </div>
                </div>
              ))}
              {(!album.media || album.media.filter(m => m.status === 'active').length === 0) && (
                <div className="col-span-full py-8 text-center text-muted-foreground bg-background/30 rounded-lg">
                  No media in this album yet.
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}