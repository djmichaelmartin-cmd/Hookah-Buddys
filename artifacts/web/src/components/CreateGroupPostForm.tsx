import { useState, useRef } from "react";
import { useCreateGroupPost, getListGroupPostsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Image as ImageIcon, Video as VideoIcon, X, Loader2 } from "lucide-react";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { uploadImage, uploadVideo, MAX_IMAGE_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES, ALLOWED_VIDEO_TYPES } from "@/lib/uploadImage";

export function CreateGroupPostForm({
  groupId,
  onCreated,
}: {
  groupId: number;
  onCreated?: () => void;
}) {
  const { data: session } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string>("");
  const [posterUrl, setPosterUrl] = useState<string>("");
  const [mediaType, setMediaType] = useState<"none" | "image" | "video">("none");
  const [isUploading, setIsUploading] = useState(false);

  const createPost = useCreateGroupPost({
    mutation: {
      onSuccess: () => {
        setText("");
        setMediaUrl("");
        setPosterUrl("");
        setMediaType("none");
        queryClient.invalidateQueries({ queryKey: getListGroupPostsQueryKey(groupId) });
        toast({ title: "Posted successfully" });
        onCreated?.();
      },
      onError: () => toast({ title: "Failed to post", description: "Please try again.", variant: "destructive" }),
    }
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith("video/")) {
      toast({ title: "Use the Video button", description: "Please choose an image, or use the Video button for videos.", variant: "destructive" });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      toast({ title: "File too large", description: "Maximum image size is 10MB.", variant: "destructive" });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsUploading(true);
    try {
      const url = await uploadImage(file);
      setMediaUrl(url);
      setPosterUrl("");
      setMediaType("image");
    } catch (err) {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
      toast({ title: "Unsupported video format", variant: "destructive" });
      if (videoInputRef.current) videoInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      toast({ title: "File too large", variant: "destructive" });
      if (videoInputRef.current) videoInputRef.current.value = "";
      return;
    }

    setIsUploading(true);
    try {
      const { url, posterUrl: uploadedPosterUrl } = await uploadVideo(file);
      setMediaUrl(url);
      setPosterUrl(uploadedPosterUrl);
      setMediaType("video");
    } catch (err) {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const removeMedia = () => {
    setMediaUrl("");
    setPosterUrl("");
    setMediaType("none");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (videoInputRef.current) videoInputRef.current.value = "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !mediaUrl) return;

    createPost.mutate({
      groupId,
      data: {
        text,
        mediaUrl: mediaUrl || undefined,
        posterUrl: posterUrl || undefined,
        mediaType: mediaType,
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-white/5 rounded-2xl p-4 shadow-sm">
      <div className="flex gap-4">
        <Avatar className="h-10 w-10 border border-white/10 shrink-0">
          <AvatarImage src={""} />
          <AvatarFallback className="bg-primary/20 text-primary">
            {session?.user?.name?.charAt(0) || "U"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Share something with the group..."
            className="min-h-[80px] bg-background/50 border-white/10 resize-none text-[15px]"
            maxLength={1000}
          />

          {mediaUrl && (
            <div className="relative rounded-xl overflow-hidden bg-black/50 border border-white/10">
              <button
                type="button"
                onClick={removeMedia}
                className="absolute top-2 right-2 z-10 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              {mediaType === "video" ? (
                <video src={mediaUrl} poster={posterUrl} className="max-h-[300px] w-full object-contain" />
              ) : (
                <img src={mediaUrl} className="max-h-[300px] w-full object-contain" alt="" />
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <div className="flex items-center gap-1">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
              <input type="file" accept="video/mp4,video/webm" className="hidden" ref={videoInputRef} onChange={handleVideoChange} />
              
              <Button type="button" variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} className="text-muted-foreground hover:text-white" disabled={isUploading}>
                <ImageIcon className="w-4 h-4 mr-2" /> Image
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => videoInputRef.current?.click()} className="text-muted-foreground hover:text-white" disabled={isUploading}>
                <VideoIcon className="w-4 h-4 mr-2" /> Video
              </Button>
            </div>

            <Button
              type="submit"
              disabled={(!text.trim() && !mediaUrl) || createPost.isPending || isUploading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full font-bold px-6"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : createPost.isPending ? "Posting..." : "Post"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
