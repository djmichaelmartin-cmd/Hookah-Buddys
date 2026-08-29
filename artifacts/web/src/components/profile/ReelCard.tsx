import { useState } from "react";
import {
  useToggleReelLike,
  useToggleReelSave,
  useRecordReelView,
  useListReelComments,
  useCreateReelComment,
  useReportReel,
  getListReelsQueryKey,
  getListReelCommentsQueryKey,
  type Reel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, MessageCircle, Bookmark, Flag, X, Send, Play, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ReelCardProps {
  reel: Reel;
  onClick: () => void;
}

export function ReelCard({ reel, onClick }: ReelCardProps) {
  return (
    <button
      onClick={onClick}
      className="group relative aspect-[9/16] rounded-xl overflow-hidden bg-card border border-white/10 hover:border-primary/40 transition-all"
    >
      {reel.thumbnailUrl ? (
        <img
          src={reel.thumbnailUrl}
          alt={reel.caption || "Spark"}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-primary/20 via-background to-secondary/20" />
      )}
      
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/20 flex flex-col justify-end p-4">
        <div className="flex items-center justify-center mb-auto mt-4">
          <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Play className="w-8 h-8 text-white fill-white" />
          </div>
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-white">
            <span className="flex items-center gap-1">
              <Heart className="w-4 h-4" />
              {reel.likeCount || 0}
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle className="w-4 h-4" />
              {reel.commentCount || 0}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="w-4 h-4" />
              {reel.viewCount || 0}
            </span>
          </div>
          {reel.caption && (
            <p className="text-sm text-white line-clamp-2">{reel.caption}</p>
          )}
        </div>
      </div>
      
      {reel.category && (
        <span className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/70 backdrop-blur-sm text-[10px] font-semibold text-white uppercase tracking-wider">
          {reel.category.replace(/_/g, " ")}
        </span>
      )}
    </button>
  );
}

export function ReelPlayer({ reel, onClose }: { reel: Reel; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");

  const recordView = useRecordReelView({
    mutation: { onError: () => {} },
  });

  const { data: comments } = useListReelComments(reel.id, {
    query: {
      enabled: true,
      queryKey: getListReelCommentsQueryKey(reel.id),
    },
  });

  const toggleLike = useToggleReelLike({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListReelsQueryKey({}) });
      },
      onError: () => toast({ title: "Failed to like", variant: "destructive" }),
    },
  });

  const toggleSave = useToggleReelSave({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListReelsQueryKey({}) });
      },
      onError: () => toast({ title: "Failed to save", variant: "destructive" }),
    },
  });

  const createComment = useCreateReelComment({
    mutation: {
      onSuccess: () => {
        setCommentText("");
        queryClient.invalidateQueries({
          queryKey: getListReelCommentsQueryKey(reel.id),
        });
      },
      onError: () => toast({ title: "Failed to comment", variant: "destructive" }),
    },
  });

  const report = useReportReel({
    mutation: {
      onSuccess: () => {
        toast({ title: "Spark reported" });
        onClose();
      },
      onError: () => toast({ title: "Failed to report", variant: "destructive" }),
    },
  });

  const handleComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    createComment.mutate({ id: reel.id, data: { commentText } });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl p-0 bg-card border-white/10 overflow-hidden">
        <div className="grid md:grid-cols-2 max-h-[90vh]">
          {/* Video */}
          <div className="bg-black flex items-center justify-center">
            <video
              src={reel.videoUrl}
              controls
              autoPlay
              playsInline
              className="w-full h-full object-contain"
              onPlay={() => recordView.mutate({ id: reel.id })}
            />
          </div>

          {/* Sidebar */}
          <div className="flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <Avatar className="w-10 h-10 border border-white/10">
                  <AvatarImage src={reel.userPhotoUrl || ""} />
                  <AvatarFallback className="bg-background text-primary">
                    {reel.userName?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-white font-semibold">{reel.userName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(reel.createdAt))} ago
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

            {/* Caption & Hashtags */}
            <div className="p-4 border-b border-white/10">
              {reel.caption && <p className="text-white mb-2">{reel.caption}</p>}
              {reel.hashtags && reel.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {reel.hashtags.map((tag, i) => (
                    <span key={i} className="text-sm text-primary">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

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
                  onClick={() => toggleLike.mutate({ id: reel.id })}
                  disabled={toggleLike.isPending}
                  className="flex items-center gap-2 text-white hover:text-primary transition-colors"
                >
                  <Heart
                    className={`w-6 h-6 ${
                      reel.viewerLiked ? "fill-primary text-primary" : ""
                    }`}
                  />
                  <span className="text-sm font-semibold">
                    {reel.likeCount || 0}
                  </span>
                </button>
                <button className="flex items-center gap-2 text-white">
                  <MessageCircle className="w-6 h-6" />
                  <span className="text-sm font-semibold">
                    {reel.commentCount || 0}
                  </span>
                </button>
                <button
                  onClick={() => toggleSave.mutate({ id: reel.id })}
                  disabled={toggleSave.isPending}
                  className="flex items-center gap-2 text-white hover:text-primary transition-colors"
                >
                  <Bookmark
                    className={`w-6 h-6 ${
                      reel.viewerSaved ? "fill-primary text-primary" : ""
                    }`}
                  />
                </button>
                <button
                  onClick={() => report.mutate({ id: reel.id, data: { reason: "inappropriate" } })}
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
