import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useToggleReelLike,
  useToggleReelSave,
  useRecordReelView,
  useListReelComments,
  useCreateReelComment,
  useReportReel,
  useToggleFollow,
  useGetCurrentUser,
  getListReelsQueryKey,
  getGetReelQueryKey,
  getListReelCommentsQueryKey,
  type Reel,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BuddyPill } from "@/components/BuddyPill";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Heart, MessageCircle, Bookmark, Flag, X, Send, Share2, MapPin, Smile, Tag, Users, Store } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SparkPlayerProps {
  spark: Reel;
  onClose: () => void;
  inline?: boolean;
}

export function SparkPlayer({ spark, onClose, inline = false }: SparkPlayerProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const recordViewRef = useRef(false);

  const recordView = useRecordReelView({ mutation: { onError: () => {} } });

  const { data: comments } = useListReelComments(spark.id, {
    query: {
      enabled: true,
      queryKey: getListReelCommentsQueryKey(spark.id),
    },
  });

  const toggleLike = useToggleReelLike({
    mutation: {
      onSuccess: () => {
        // Optimistically update cache to feel immediate
        queryClient.setQueryData(getListReelsQueryKey({}), (oldData: any) => {
          if (!oldData) return oldData;
          return oldData.map((r: Reel) => {
            if (r.id === spark.id) {
              return { 
                ...r, 
                viewerLiked: !r.viewerLiked, 
                likeCount: r.viewerLiked ? (r.likeCount || 1) - 1 : (r.likeCount || 0) + 1 
              };
            }
            return r;
          });
        });
      },
      onError: () => toast({ title: "Failed to like", variant: "destructive" }),
    },
  });

  const toggleSave = useToggleReelSave({
    mutation: {
      onSuccess: () => {
        queryClient.setQueryData(getListReelsQueryKey({}), (oldData: any) => {
          if (!oldData) return oldData;
          return oldData.map((r: Reel) => {
            if (r.id === spark.id) return { ...r, viewerSaved: !r.viewerSaved };
            return r;
          });
        });
      },
      onError: () => toast({ title: "Failed to save", variant: "destructive" }),
    },
  });

  const createComment = useCreateReelComment({
    mutation: {
      onSuccess: () => {
        setCommentText("");
        queryClient.invalidateQueries({ queryKey: getListReelCommentsQueryKey(spark.id) });
        queryClient.invalidateQueries({ queryKey: getListReelsQueryKey({}) });
      },
      onError: () => toast({ title: "Failed to comment", variant: "destructive" }),
    },
  });

  const report = useReportReel({
    mutation: {
      onSuccess: () => {
        toast({ title: "Spark reported", description: "Our moderation team will review this shortly." });
        if (!inline) onClose();
      },
      onError: () => toast({ title: "Failed to report", variant: "destructive" }),
    },
  });

  const { data: session } = useGetCurrentUser();
  const toggleFollow = useToggleFollow({
    mutation: {
      onSuccess: () => {
        queryClient.setQueryData(getListReelsQueryKey({}), (oldData: any) => {
          if (!oldData) return oldData;
          return oldData.map((r: Reel) => {
            if (r.userId === spark.userId) return { ...r, viewerFollowsAuthor: !r.viewerFollowsAuthor };
            return r;
          });
        });
        queryClient.setQueryData(getGetReelQueryKey(spark.id), (old: any) => 
          old ? { ...old, viewerFollowsAuthor: !old.viewerFollowsAuthor } : old
        );
      },
      onError: () => toast({ title: "Failed to update follow", variant: "destructive" }),
    }
  });

  const handleComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    createComment.mutate({ id: spark.id, data: { commentText } });
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/sparks/${spark.id}`);
      toast({ title: "Link copied!", description: "Spark link copied to clipboard." });
    } catch (err) {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handlePlay = () => {
    if (!recordViewRef.current) {
      recordView.mutate({ id: spark.id });
      recordViewRef.current = true;
    }
  };

  const content = (
    <div className={`grid lg:grid-cols-[1.5fr_1fr] bg-card overflow-hidden ${inline ? 'rounded-3xl border border-white/10 shadow-2xl h-[80vh] min-h-[600px]' : 'h-[90vh] md:h-[80vh]'}`}>
      <div className="bg-black flex items-center justify-center relative group h-[50vh] lg:h-full">
        <video
          ref={videoRef}
          src={spark.videoUrl}
          controls
          autoPlay
          playsInline
          loop
          className="w-full h-full object-contain"
          onPlay={handlePlay}
        />
        {inline && (
          <button onClick={onClose} title="Close Player" aria-label="Close Player" className="absolute top-6 left-6 w-10 h-10 bg-black/40 border border-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors z-10 lg:hidden">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="flex flex-col h-full bg-accent/10 lg:border-l border-white/5 max-h-[40vh] lg:max-h-full">
        <div className="flex items-center justify-between p-5 border-b border-white/5 bg-card/50">
          <div className="flex items-center gap-4">
            <Avatar className="w-12 h-12 border-2 border-primary/20 shadow-sm">
              <AvatarImage src={spark.userPhotoUrl || ""} />
              <AvatarFallback className="bg-background text-primary font-bold">
                {spark.userName?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-white font-bold text-lg leading-tight">{spark.userName}</p>
                {(!spark.businessId) && (
                  <BuddyPill buddyType={spark.buddyType} className="scale-[0.8] origin-left" />
                )}
                {session?.user && session.user.id !== spark.userId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-6 px-2 text-xs font-bold rounded-full border ${
                      spark.viewerFollowsAuthor 
                        ? 'border-white/10 text-white/60 hover:text-white hover:bg-white/10' 
                        : 'border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground'
                    }`}
                    onClick={() => toggleFollow.mutate({ userId: spark.userId })}
                    disabled={toggleFollow.isPending}
                  >
                    {spark.viewerFollowsAuthor ? 'Following' : 'Follow'}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">
                {formatDistanceToNow(new Date(spark.createdAt || Date.now()))} ago
              </p>
            </div>
          </div>
          {!inline && (
            <button onClick={onClose} title="Close Player" aria-label="Close Player" className="text-muted-foreground hover:text-white transition-colors p-2 rounded-full hover:bg-white/10" data-testid="button-close-player">
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        <div className="p-5 border-b border-white/5 bg-card/30">
          {spark.caption && <p className="text-white/95 text-[15px] leading-relaxed mb-3">{spark.caption}</p>}
          
          <div className="flex flex-wrap items-center gap-3 mb-3 text-xs font-medium text-white/60">
            {spark.category && (
              <span className="flex items-center gap-1.5 text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                <Tag className="w-3.5 h-3.5" />
                {spark.category.replace(/_/g, " ")}
              </span>
            )}
            
            {spark.businessId && spark.businessHandle && (
              <Link href={`/businesses/${spark.businessHandle}`} className="flex items-center gap-1.5 text-[#D6B56D] hover:underline bg-[#D6B56D]/10 px-2 py-0.5 rounded-full transition-colors">
                <Store className="w-3.5 h-3.5" />
                {spark.businessName || spark.businessHandle}
              </Link>
            )}

            {spark.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                {spark.location}
              </span>
            )}

            {spark.feeling && (
              <span className="flex items-center gap-1.5">
                <Smile className="w-3.5 h-3.5" />
                {spark.feeling}
              </span>
            )}

            {spark.peopleTags && spark.peopleTags.length > 0 && (
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                {spark.peopleTags.length} {spark.peopleTags.length === 1 ? 'person' : 'people'}
              </span>
            )}
          </div>

          {spark.hashtags && spark.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {spark.hashtags.map((tag, i) => (
                <span key={i} className="text-sm font-bold text-primary hover:text-primary/80 cursor-pointer transition-colors">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-thin">
          {spark.commentsEnabled === false ? (
            <div className="text-center py-10 text-muted-foreground font-medium">
              Comments are disabled for this Spark.
            </div>
          ) : (
            <>
              {comments?.map((comment) => (
                <div key={comment.id} className="flex gap-4">
                  <Avatar className="w-10 h-10 border border-white/10 shrink-0">
                    <AvatarImage src="" />
                    <AvatarFallback className="bg-muted text-muted-foreground text-sm font-bold">
                      {comment.userName?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="bg-white/5 rounded-2xl rounded-tl-none p-3 shadow-sm border border-white/5">
                      <span className="font-bold text-white text-sm block mb-1">
                        {comment.userName}
                      </span>
                      <span className="text-white/80 text-[14px] leading-snug">{comment.commentText}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 ml-2 font-medium">
                      {formatDistanceToNow(new Date(comment.createdAt || Date.now()))} ago
                    </p>
                  </div>
                </div>
              ))}
              {(!comments || comments.length === 0) && (
                <div className="text-center py-10 text-muted-foreground font-medium">
                  No comments yet. Be the first to start the conversation!
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-white/5 p-5 bg-card/80 backdrop-blur-md space-y-4">
          <div className="flex items-center gap-5">
            <button
              onClick={() => toggleLike.mutate({ id: spark.id })}
              disabled={toggleLike.isPending}
              className="flex items-center gap-2 text-white hover:text-primary transition-colors group"
              title={spark.viewerLiked ? "Unlike" : "Like"}
              aria-label={spark.viewerLiked ? "Unlike" : "Like"}
              data-testid={`button-like-spark-${spark.id}`}
            >
              <div className={`p-2 rounded-full transition-all ${spark.viewerLiked ? 'bg-primary/20 scale-110' : 'bg-white/5 group-hover:bg-white/10 group-active:scale-95'}`}>
                <Heart className={`w-6 h-6 ${spark.viewerLiked ? "fill-primary text-primary" : ""}`} />
              </div>
              <span className="text-sm font-bold">{spark.likeCount || 0}</span>
            </button>
            {spark.commentsEnabled !== false && (
              <div className="flex items-center gap-2 text-white" title="Comments" aria-label="Comments">
                <div className="p-2 rounded-full bg-white/5">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <span className="text-sm font-bold">{spark.commentCount || 0}</span>
              </div>
            )}
            <button
              onClick={() => toggleSave.mutate({ id: spark.id })}
              disabled={toggleSave.isPending}
              className="flex items-center gap-2 text-white hover:text-primary transition-colors group"
              title={spark.viewerSaved ? "Remove from saved" : "Save Spark"}
              aria-label={spark.viewerSaved ? "Remove from saved" : "Save Spark"}
              data-testid={`button-save-spark-${spark.id}`}
            >
              <div className={`p-2 rounded-full transition-all ${spark.viewerSaved ? 'bg-primary/20 scale-110' : 'bg-white/5 group-hover:bg-white/10 group-active:scale-95'}`}>
                <Bookmark className={`w-6 h-6 ${spark.viewerSaved ? "fill-primary text-primary" : ""}`} />
              </div>
            </button>
            {spark.sharingEnabled !== false && (
              <button
                onClick={handleShare}
                className="flex items-center gap-2 text-white hover:text-primary transition-colors group"
                title="Share Spark"
                aria-label="Share Spark"
                data-testid={`button-share-spark-${spark.id}`}
              >
                <div className="p-2 rounded-full bg-white/5 group-hover:bg-white/10 group-active:scale-95 transition-all">
                  <Share2 className="w-6 h-6" />
                </div>
              </button>
            )}
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="ml-auto p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors"
                  title="Report Spark"
                  aria-label="Report Spark"
                  data-testid={`button-report-menu-spark-${spark.id}`}
                >
                  <Flag className="w-5 h-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-white/10 text-white w-48">
                <DropdownMenuItem onClick={() => report.mutate({ id: spark.id, data: { reason: "inappropriate" } })} className="hover:bg-white/10 cursor-pointer">
                  Inappropriate content
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => report.mutate({ id: spark.id, data: { reason: "spam" } })} className="hover:bg-white/10 cursor-pointer">
                  Spam
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => report.mutate({ id: spark.id, data: { reason: "harassment" } })} className="hover:bg-white/10 cursor-pointer">
                  Harassment
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => report.mutate({ id: spark.id, data: { reason: "other" } })} className="hover:bg-white/10 cursor-pointer">
                  Other
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {spark.commentsEnabled !== false && (
            <form onSubmit={handleComment} className="flex gap-3 relative">
              <Input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment..."
                className="bg-background/80 border-white/10 rounded-full px-5 py-6 pr-14 focus-visible:ring-primary/50 text-[15px] shadow-inner"
                aria-label="Add a comment"
                data-testid="input-spark-comment"
              />
              <Button
                type="submit"
                size="icon"
                disabled={createComment.isPending || !commentText.trim()}
                className="absolute right-1.5 top-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shrink-0 rounded-full w-9 h-9 shadow-lg transition-transform active:scale-95"
                title="Submit comment"
                aria-label="Submit comment"
                data-testid="button-submit-comment"
              >
                <Send className="w-4 h-4 ml-0.5" />
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  if (inline) {
    return content;
  }

  return (
    <Dialog open onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="max-w-6xl p-0 bg-transparent border-0 shadow-none overflow-hidden [&>button]:hidden">
        <DialogTitle className="sr-only">Spark Player</DialogTitle>
        <DialogDescription className="sr-only">
          Watch this Spark and interact with its comments and engagement controls.
        </DialogDescription>
        <div className="rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.6)] border border-white/10 w-full mx-auto">
          {content}
        </div>
      </DialogContent>
    </Dialog>
  );
}
