import { useState } from "react";
import {
  useTogglePhotoLike,
  useListPhotoComments,
  useCreatePhotoComment,
  useReportPhoto,
  getListUserPhotosQueryKey,
  getListPhotoCommentsQueryKey,
  type Photo,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, MessageCircle, Flag, X, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface PhotoGridProps {
  photos: Photo[];
  userId: number;
}

export function PhotoGrid({ photos, userId }: PhotoGridProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);

  if (photos.length === 0) {
    return (
      <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
        <p className="text-muted-foreground">No photos yet.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {photos.map((photo) => (
          <button
            key={photo.id}
            onClick={() => setSelectedPhoto(photo)}
            className="relative aspect-square rounded-lg overflow-hidden bg-card border border-white/10 group hover:border-primary/40 transition-all"
          >
            <img
              src={photo.imageUrl}
              alt={photo.caption || "Photo"}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
              <div className="flex gap-4 text-white">
                <span className="flex items-center gap-1">
                  <Heart className="w-5 h-5 fill-white" />
                  {photo.likeCount || 0}
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="w-5 h-5" />
                  {photo.commentCount || 0}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {selectedPhoto && (
        <PhotoLightbox
          photo={selectedPhoto}
          userId={userId}
          onClose={() => setSelectedPhoto(null)}
        />
      )}
    </>
  );
}

function PhotoLightbox({
  photo,
  userId,
  onClose,
}: {
  photo: Photo;
  userId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");

  const { data: comments } = useListPhotoComments(photo.id, {
    query: {
      enabled: true,
      queryKey: getListPhotoCommentsQueryKey(photo.id),
    },
  });

  const toggleLike = useTogglePhotoLike({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListUserPhotosQueryKey({ userId }),
        });
      },
      onError: () => toast({ title: "Failed to like", variant: "destructive" }),
    },
  });

  const createComment = useCreatePhotoComment({
    mutation: {
      onSuccess: () => {
        setCommentText("");
        queryClient.invalidateQueries({
          queryKey: getListPhotoCommentsQueryKey(photo.id),
        });
        queryClient.invalidateQueries({
          queryKey: getListUserPhotosQueryKey({ userId }),
        });
      },
      onError: () => toast({ title: "Failed to comment", variant: "destructive" }),
    },
  });

  const report = useReportPhoto({
    mutation: {
      onSuccess: () => {
        toast({ title: "Photo reported" });
        onClose();
      },
      onError: () => toast({ title: "Failed to report", variant: "destructive" }),
    },
  });

  const handleLike = () => {
    toggleLike.mutate({ id: photo.id });
  };

  const handleComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    createComment.mutate({ id: photo.id, data: { commentText } });
  };

  const handleReport = () => {
    report.mutate({
      id: photo.id,
      data: { reason: "inappropriate", notes: "Reported from profile" },
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-5xl p-0 bg-card border-white/10 overflow-hidden">
        <div className="grid md:grid-cols-2 max-h-[90vh]">
          {/* Image */}
          <div className="bg-black flex items-center justify-center">
            <img
              src={photo.imageUrl}
              alt={photo.caption || "Photo"}
              className="w-full h-full object-contain"
            />
          </div>

          {/* Sidebar */}
          <div className="flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <Avatar className="w-10 h-10 border border-white/10">
                  <AvatarImage src={photo.userPhotoUrl || ""} />
                  <AvatarFallback className="bg-background text-primary">
                    {photo.userName?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-white font-semibold">{photo.userName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(photo.createdAt))} ago
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Caption */}
            {photo.caption && (
              <div className="p-4 border-b border-white/10">
                <p className="text-white">{photo.caption}</p>
              </div>
            )}

            {/* Comments */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {comments?.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  <Avatar className="w-8 h-8 border border-white/10 shrink-0">
                    <AvatarImage src="" />
                    <AvatarFallback className="bg-background text-primary text-xs">
                      {comment.userName?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="text-sm">
                      <span className="font-semibold text-white">
                        {comment.userName}
                      </span>{" "}
                      <span className="text-white/80">{comment.commentText}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(comment.createdAt))} ago
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="border-t border-white/10 p-4 space-y-3">
              <div className="flex items-center gap-4">
                <button
                  onClick={handleLike}
                  disabled={toggleLike.isPending}
                  className="flex items-center gap-2 text-white hover:text-primary transition-colors"
                >
                  <Heart
                    className={`w-6 h-6 ${
                      photo.viewerLiked ? "fill-primary text-primary" : ""
                    }`}
                  />
                  <span className="text-sm font-semibold">
                    {photo.likeCount || 0}
                  </span>
                </button>
                <button className="flex items-center gap-2 text-white">
                  <MessageCircle className="w-6 h-6" />
                  <span className="text-sm font-semibold">
                    {photo.commentCount || 0}
                  </span>
                </button>
                <button
                  onClick={handleReport}
                  className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Flag className="w-5 h-5" />
                </button>
              </div>

              {/* Comment Form */}
              <form onSubmit={handleComment} className="flex gap-2">
                <Input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a comment..."
                  className="bg-background/50 border-white/10"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={createComment.isPending || !commentText.trim()}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
