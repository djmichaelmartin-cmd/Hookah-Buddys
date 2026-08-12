import { useState, useRef } from "react";
import { useCreateFeedPost, getListFeedPostsQueryKey, type FeedPostInputCategory } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Image as ImageIcon, Video as VideoIcon, X, Sparkles, Loader2 } from "lucide-react";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { uploadImage, uploadVideo, MAX_IMAGE_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES, ALLOWED_VIDEO_TYPES } from "@/lib/uploadImage";

const CATEGORIES: { value: FeedPostInputCategory; label: string }[] = [
  { value: "discussion", label: "Discussion" },
  { value: "setup", label: "Setup" },
  { value: "lounge", label: "Lounge" },
  { value: "flavor", label: "Flavor" },
  { value: "event", label: "Event" },
  { value: "review", label: "Review" },
  { value: "question", label: "Question" },
  { value: "meme", label: "Meme" },
];

export function CreatePostForm() {
  const { data: session } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [category, setCategory] = useState<FeedPostInputCategory>("discussion");
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string>("");
  const [posterUrl, setPosterUrl] = useState<string>("");
  const [mediaType, setMediaType] = useState<"none" | "image" | "video">("none");
  const [isUploading, setIsUploading] = useState(false);

  const createPost = useCreateFeedPost({
    mutation: {
      onSuccess: () => {
        setText("");
        setCategory("discussion");
        setIsConfirmed(false);
        setMediaUrl("");
        setPosterUrl("");
        setMediaType("none");
        queryClient.invalidateQueries({ queryKey: getListFeedPostsQueryKey() });
        toast({ title: "Posted successfully", description: "Your post is now live in the feed." });
      },
      onError: () => toast({ title: "Failed to post", description: "Please try again.", variant: "destructive" }),
    }
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith("video/")) {
      toast({ title: "Use the Video button", description: "Please choose an image (JPEG, PNG, WebP, GIF, or AVIF), or use the Video button for videos.", variant: "destructive" });
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
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setIsUploading(false);
    }
  };

  const handleVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
      toast({ title: "Unsupported video format", description: "Please choose an MP4 or WebM video.", variant: "destructive" });
      if (videoInputRef.current) videoInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      toast({ title: "File too large", description: "Maximum video size is 50MB.", variant: "destructive" });
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
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      if (videoInputRef.current) videoInputRef.current.value = "";
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
    if (!text.trim() && mediaType === "none") return;
    if (!isConfirmed) return;

    createPost.mutate({
      data: {
        text,
        category,
        mediaType,
        mediaUrl: mediaUrl || undefined,
        posterUrl: posterUrl || undefined,
        isHookahRelatedConfirmed: isConfirmed
      }
    });
  };

  if (!session?.authenticated || !session.user) {
    return (
      <div className="bg-card/40 backdrop-blur-md border border-white/5 rounded-2xl p-6 text-center">
        <Sparkles className="h-8 w-8 text-primary mx-auto mb-3" />
        <h2 className="font-serif text-xl text-white mb-2">Join the Conversation</h2>
        <p className="text-muted-foreground text-sm mb-4">Log in to post your setups, review lounges, and connect with the community.</p>
      </div>
    );
  }

  const user = session.user;

  return (
    <div className="bg-card/60 backdrop-blur-xl border border-primary/20 rounded-2xl p-4 md:p-6 shadow-[0_0_30px_rgba(212,175,55,0.05)]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex gap-4">
          <Avatar className="h-10 w-10 border border-white/10 shrink-0">
            <AvatarFallback className="bg-background text-primary font-serif">
              {user.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <Textarea
              placeholder="What's in your bowl today?"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[100px] resize-none bg-background/50 border-white/10 focus-visible:ring-primary text-base"
            />
          </div>
        </div>

        {isUploading && (
          <div className="pl-14 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Uploading media...
          </div>
        )}

        {mediaUrl && (
          <div className="pl-14">
            <div className="relative inline-block rounded-xl overflow-hidden border border-white/10 bg-black/50">
              <button
                type="button"
                onClick={removeMedia}
                className="absolute top-2 right-2 z-10 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80 transition-colors backdrop-blur-md"
              >
                <X className="h-4 w-4" />
              </button>
              {mediaType === "video" ? (
                <video src={mediaUrl} poster={posterUrl || undefined} preload="metadata" controls className="max-h-64 object-contain" />
              ) : (
                <img src={mediaUrl} alt="Upload preview" className="max-h-64 object-contain" />
              )}
            </div>
          </div>
        )}

        <div className="pl-14 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-white/5">
          <div className="flex items-center flex-wrap gap-3">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-white/10 bg-background/50 hover:bg-white/10 hover:text-white text-muted-foreground h-9"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon className="h-4 w-4 mr-2" /> Photo
            </Button>

            <input
              type="file"
              accept="video/mp4,video/webm"
              className="hidden"
              ref={videoInputRef}
              onChange={handleVideoChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-white/10 bg-background/50 hover:bg-white/10 hover:text-white text-muted-foreground h-9"
              onClick={() => videoInputRef.current?.click()}
            >
              <VideoIcon className="h-4 w-4 mr-2" /> Video
            </Button>

            <Select value={category} onValueChange={(val: FeedPostInputCategory) => setCategory(val)}>
              <SelectTrigger className="w-[130px] h-9 rounded-full border-white/10 bg-background/50 text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent className="bg-card border-white/10">
                {CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col sm:items-end gap-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="hookah-confirm"
                checked={isConfirmed}
                onCheckedChange={(checked) => setIsConfirmed(checked === true)}
                className="border-white/20 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
              />
              <label
                htmlFor="hookah-confirm"
                className="text-xs text-muted-foreground font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                I confirm this post is hookah-related.
              </label>
            </div>
            <Button
              type="submit"
              disabled={(!text.trim() && mediaType === "none") || !isConfirmed || createPost.isPending || isUploading}
              className="rounded-full bg-primary text-primary-foreground font-semibold px-8 hover:bg-primary/90 transition-colors shadow-[0_0_15px_rgba(212,175,55,0.2)]"
            >
              {createPost.isPending ? "Posting..." : "Post"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
