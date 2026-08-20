import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { 
  useListGroupMedia, 
  useUploadGroupFile,
  useUploadGroupMedia,
  useDeleteGroupMedia,
  getListGroupMediaQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { FileText, Image as ImageIcon, Upload, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadImage, uploadVideo } from "@/lib/uploadImage";
import { getErrorMessage } from "@/lib/error";

export function GroupMedia({
  groupId,
  kind,
  canUpload,
  canDelete,
}: {
  groupId: number;
  kind?: string;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const routeToKind = {
    photos: "photo",
    videos: "video",
    reels: "reel",
    files: "file",
    photo: "photo",
    video: "video",
    reel: "reel",
    file: "file",
  } as const;
  const mediaKind =
    kind && kind !== "media"
      ? routeToKind[kind as keyof typeof routeToKind]
      : undefined;
  const activeRoute =
    mediaKind === "photo"
      ? "photos"
      : mediaKind === "video"
        ? "videos"
        : mediaKind === "reel"
          ? "reels"
          : mediaKind === "file"
            ? "files"
            : "media";
  const { data: media, isLoading } = useListGroupMedia(groupId, { limit: 50, kind: mediaKind }, { query: { queryKey: getListGroupMediaQueryKey(groupId, { limit: 50, kind: mediaKind }) } });
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const uploadGroupFileMutation = useUploadGroupFile();

  const uploadMediaMutation = useUploadGroupMedia({
    mutation: {
      onSuccess: () => {
        toast({ title: "Media uploaded" });
        queryClient.invalidateQueries({ queryKey: getListGroupMediaQueryKey(groupId, { limit: 50, kind: mediaKind }) });
      },
      onError: () => toast({ title: "Failed to upload media", variant: "destructive" })
    }
  });

  const deleteMediaMutation = useDeleteGroupMedia({
    mutation: {
      onSuccess: () => {
        toast({ title: "Media deleted" });
        queryClient.invalidateQueries({ queryKey: getListGroupMediaQueryKey(groupId, { limit: 50, kind: mediaKind }) });
      },
      onError: () => toast({ title: "Failed to delete media", variant: "destructive" })
    }
  });

  const handleTabChange = (newKind: string) => {
    setLocation(`/groups/${groupId}/${newKind}`);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      let url = "";
      let posterUrl = "";
      let uploadKind: "photo" | "video" | "reel" | "file" = "photo";
      let fileName: string | undefined;
      let mimeType: string | undefined;
      let fileSizeBytes: number | undefined;

      if (mediaKind === "file" || file.type === "application/pdf") {
        const stored = await uploadGroupFileMutation.mutateAsync({ data: file });
        url = stored.objectPath;
        uploadKind = "file";
        fileName = file.name;
        mimeType = stored.contentType;
        fileSizeBytes = file.size;
      } else if (file.type.startsWith("video/")) {
        const res = await uploadVideo(file);
        url = res.url;
        posterUrl = res.posterUrl || "";
        uploadKind = mediaKind === "reel" ? "reel" : "video";
      } else {
        url = await uploadImage(file);
        uploadKind = "photo";
      }

      await uploadMediaMutation.mutateAsync({
        groupId,
        data: {
          mediaUrl: url,
          posterUrl: posterUrl || undefined,
          kind: uploadKind,
          fileName,
          mimeType,
          fileSizeBytes,
        },
      });
    } catch (err: unknown) {
      toast({
        title: "Upload failed",
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="bg-card border border-white/10 rounded-2xl p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h3 className="text-xl font-serif text-white">Media Gallery</h3>
        <div className="flex gap-2 bg-background/50 p-1 rounded-xl border border-white/5">
          {[
            { route: "media", label: "All", testId: "media" },
            { route: "photos", label: "Photos", testId: "photo" },
            { route: "videos", label: "Videos", testId: "video" },
            { route: "reels", label: "Reels", testId: "reel" },
            { route: "files", label: "Files", testId: "file" },
          ].map((tab) => (
            <button
              key={tab.route}
              onClick={() => handleTabChange(tab.route)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                activeRoute === tab.route ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-white"
              }`}
              data-testid={`media-tab-${tab.testId}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      
      {canUpload && (
        <div className="mb-6">
          <input
            type="file"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept={mediaKind === "file" ? "application/pdf,image/jpeg,image/png,image/webp" : "image/*,video/mp4,video/webm,application/pdf"}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || uploadMediaMutation.isPending || uploadGroupFileMutation.isPending}
            data-testid="upload-media-btn"
          >
            {isUploading || uploadMediaMutation.isPending || uploadGroupFileMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Upload Media
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="animate-pulse h-32 bg-background/50 rounded-xl" />
      ) : !media || media.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-white/10 rounded-2xl">
          <ImageIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-muted-foreground">No media shared yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {media.map(m => (
            <div key={m.id} className="group aspect-square bg-black/50 rounded-xl overflow-hidden border border-white/10 relative">
              {m.kind === "file" ? (
                <a
                  href={m.mediaUrl}
                  download={m.fileName || true}
                  className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-white/80 hover:text-white"
                  data-testid={`group-file-${m.id}`}
                >
                  <FileText className="h-10 w-10 text-primary" />
                  <span className="line-clamp-2 text-xs">{m.fileName || "Download file"}</span>
                </a>
              ) : m.kind === 'video' || m.kind === "reel" ? (
                <video src={m.mediaUrl} className="w-full h-full object-cover" />
              ) : (
                <img src={m.mediaUrl} className="w-full h-full object-cover" />
              )}
              {canDelete && (
                <button 
                  className="absolute top-2 right-2 bg-black/60 hover:bg-destructive p-1.5 rounded-full text-white opacity-0 group-hover:opacity-100 transition-all"
                  onClick={() => deleteMediaMutation.mutate({ groupId, mediaId: m.id })}
                  data-testid={`delete-media-${m.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
