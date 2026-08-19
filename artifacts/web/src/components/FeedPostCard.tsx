import { useState, useRef } from "react";
import { Link } from "wouter";
import {
  useGetCurrentUser,
  useToggleFeedPostLike,
  useToggleFeedPostSave,
  useReportFeedPost,
  useDeleteFeedPost,
  useToggleFollow,
  useListFeedComments,
  useCreateFeedComment,
  useDeleteFeedComment,
  getGetFeedPostQueryKey,
  getListFeedPostsQueryKey,
  getListSavedFeedPostsQueryKey,
  getListLikedFeedPostsQueryKey,
  getListMyFeedPostsQueryKey,
  getListFeedCommentsQueryKey,
  type FeedPost,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Heart,
  MessageCircle,
  Bookmark,
  MoreVertical,
  Flag,
  Trash2,
  UserPlus,
  ShieldCheck,
  Send,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function FeedPostCard({
  post,
  onLoginPrompt,
}: {
  post: FeedPost;
  onLoginPrompt: () => void;
}) {
  const { data: session } = useGetCurrentUser();
  const isAuthed = session?.authenticated && session.user;
  const isOwner = session?.user?.id === post.userId;
  const [showComments, setShowComments] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleLike = useToggleFeedPostLike({
    mutation: {
      onSuccess: (data) => {
        // Optimistically patch or rely on invalidation. For simplicity, we invalidate all post lists
        queryClient.invalidateQueries({ queryKey: getListFeedPostsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListLikedFeedPostsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFeedPostQueryKey(post.id) });
      },
      onError: () => toast({ title: "Action failed", description: "Please try again.", variant: "destructive" }),
    }
  });

  const toggleSave = useToggleFeedPostSave({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFeedPostsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSavedFeedPostsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFeedPostQueryKey(post.id) });
      },
      onError: () => toast({ title: "Action failed", description: "Please try again.", variant: "destructive" }),
    }
  });

  const toggleFollow = useToggleFollow({
    mutation: {
      onSuccess: () => {
        toast({ title: "Follow status updated" });
        queryClient.invalidateQueries({ queryKey: getListFeedPostsQueryKey() });
      },
      onError: () => toast({ title: "Action failed", description: "Please try again.", variant: "destructive" }),
    }
  });

  const reportPost = useReportFeedPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post reported", description: "Our team will review this shortly." });
        setReportOpen(false);
      },
      onError: () => toast({ title: "Action failed", description: "Please try again.", variant: "destructive" }),
    }
  });

  const deletePost = useDeleteFeedPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post deleted" });
        queryClient.invalidateQueries({ queryKey: getListFeedPostsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyFeedPostsQueryKey() });
      },
      onError: () => toast({ title: "Action failed", description: "Please try again.", variant: "destructive" }),
    }
  });

  const handleLike = () => {
    if (!isAuthed) return onLoginPrompt();
    toggleLike.mutate({ id: post.id });
  };

  const handleSave = () => {
    if (!isAuthed) return onLoginPrompt();
    toggleSave.mutate({ id: post.id });
  };

  const handleFollow = () => {
    if (!isAuthed) return onLoginPrompt();
    toggleFollow.mutate({ userId: post.userId });
  };

  const handleReport = () => {
    if (!reportReason.trim()) return;
    reportPost.mutate({ id: post.id, data: { reason: reportReason, notes: "Reported from feed" } });
  };

  const authorLink = post.dollId ? `/dolls/${post.dollId}` : `/bros/${post.userId}`;
  const badgeColor = post.userRole === "doll" ? "text-[#E85D75] border-[#E85D75]/20 bg-[#E85D75]/10" : "text-[#D6B56D] border-[#D6B56D]/20 bg-[#D6B56D]/10";
  const badgeText = post.userRole === "doll" ? "Buddy" : "Bro";

  return (
    <div className="bg-card/40 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden hover:border-white/10 transition-colors">
      <div className="p-5 flex gap-4">
        <Link href={authorLink} className="shrink-0 group">
          <Avatar className="h-12 w-12 border border-white/10 group-hover:border-primary/50 transition-colors">
            <AvatarImage src={post.userPhotoUrl || ""} alt={post.userName} className="object-cover" />
            <AvatarFallback className="bg-background text-primary font-serif">
              {post.userName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
              <Link href={authorLink} className="font-serif font-bold text-white hover:text-primary transition-colors truncate max-w-[200px]">
                {post.userName}
              </Link>
              {post.userVerified && <ShieldCheck className="h-4 w-4 text-primary shrink-0" />}
              {post.username && <span className="text-muted-foreground text-sm truncate max-w-[120px]">@{post.username}</span>}
              <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${badgeColor}`}>
                {badgeText}
              </span>
              <span className="text-muted-foreground/50 text-xs">&bull;</span>
              <span className="text-muted-foreground text-xs">{formatDistanceToNow(new Date(post.createdAt))} ago</span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-white rounded-full">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card/95 backdrop-blur-xl border-white/10">
                {!isOwner && (
                  <>
                    <DropdownMenuItem onClick={handleFollow} className="cursor-pointer hover:bg-white/5 hover:text-white">
                      <UserPlus className="mr-2 h-4 w-4" />
                      <span>{post.viewerFollowsAuthor ? "Unfollow" : "Follow"} {post.userName}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { if (!isAuthed) return onLoginPrompt(); setReportOpen(true); }} className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive">
                      <Flag className="mr-2 h-4 w-4" />
                      <span>Report Post</span>
                    </DropdownMenuItem>
                  </>
                )}
                {isOwner && (
                  <DropdownMenuItem onClick={() => deletePost.mutate({ id: post.id })} className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span>Delete Post</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="mt-2 text-white/90 whitespace-pre-wrap break-words leading-relaxed text-[15px]">
            {post.text}
          </div>

          {post.mediaType !== "none" && post.mediaUrl && (
            <div className="mt-4 rounded-xl overflow-hidden border border-white/10 bg-background/50 max-h-[500px]">
              {post.mediaType === "video" ? (
                <video
                  src={post.mediaUrl}
                  poster={post.posterUrl || undefined}
                  preload={post.posterUrl ? "none" : "metadata"}
                  controls
                  playsInline
                  className="w-full max-h-[500px] object-contain"
                />
              ) : (
                <img src={post.mediaUrl} alt="Post media" loading="lazy" className="w-full max-h-[500px] object-cover" />
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-1 sm:gap-4">
              <Button
                variant="ghost"
                size="sm"
                className={`h-9 px-3 gap-2 rounded-full transition-all ${post.viewerLiked ? "text-primary bg-primary/10 hover:bg-primary/20" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                onClick={handleLike}
                disabled={toggleLike.isPending}
              >
                <Heart className={`h-4 w-4 ${post.viewerLiked ? "fill-primary" : ""}`} />
                <span className="text-xs font-medium tabular-nums">{post.likeCount}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-9 px-3 gap-2 rounded-full transition-all ${showComments ? "text-secondary bg-secondary/10 hover:bg-secondary/20" : "text-muted-foreground hover:text-secondary hover:bg-secondary/10"}`}
                onClick={() => setShowComments(!showComments)}
              >
                <MessageCircle className={`h-4 w-4 ${showComments ? "fill-secondary text-secondary" : ""}`} />
                <span className="text-xs font-medium tabular-nums">{post.commentCount}</span>
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className={`h-9 w-9 rounded-full transition-all ${post.viewerSaved ? "text-primary bg-primary/10 hover:bg-primary/20" : "text-muted-foreground hover:text-white hover:bg-white/10"}`}
              onClick={handleSave}
              disabled={toggleSave.isPending}
            >
              <Bookmark className={`h-4 w-4 ${post.viewerSaved ? "fill-primary" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      {showComments && (
        <div className="border-t border-white/5 bg-background/30 p-5 pt-4">
          <CommentSection postId={post.id} onLoginPrompt={onLoginPrompt} />
        </div>
      )}

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="bg-card border-white/10 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl text-white flex items-center gap-2">
              <Flag className="w-5 h-5 text-destructive" /> Report Post
            </DialogTitle>
            <DialogDescription>
              Help us keep the lounge safe. What's wrong with this post?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Textarea
              placeholder="Provide a reason..."
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="bg-background/50 border-white/10 focus-visible:ring-destructive min-h-[100px]"
            />
            <Button
              onClick={handleReport}
              disabled={!reportReason.trim() || reportPost.isPending}
              className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {reportPost.isPending ? "Submitting..." : "Submit Report"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommentSection({ postId, onLoginPrompt }: { postId: number; onLoginPrompt: () => void; }) {
  const { data: session } = useGetCurrentUser();
  const isAuthed = session?.authenticated && session.user;
  const [text, setText] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: comments, isLoading } = useListFeedComments(postId, {
    query: { enabled: true, queryKey: getListFeedCommentsQueryKey(postId) }
  });

  const createComment = useCreateFeedComment({
    mutation: {
      onSuccess: () => {
        setText("");
        queryClient.invalidateQueries({ queryKey: getListFeedCommentsQueryKey(postId) });
        queryClient.invalidateQueries({ queryKey: getGetFeedPostQueryKey(postId) });
        queryClient.invalidateQueries({ queryKey: getListFeedPostsQueryKey() });
      },
      onError: () => toast({ title: "Failed to post comment", description: "Please try again.", variant: "destructive" }),
    }
  });

  const deleteComment = useDeleteFeedComment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFeedCommentsQueryKey(postId) });
        queryClient.invalidateQueries({ queryKey: getGetFeedPostQueryKey(postId) });
        queryClient.invalidateQueries({ queryKey: getListFeedPostsQueryKey() });
      },
      onError: () => toast({ title: "Failed to delete comment", description: "Please try again.", variant: "destructive" }),
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthed) return onLoginPrompt();
    if (!text.trim()) return;
    createComment.mutate({ id: postId, data: { commentText: text } });
  };

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="text-sm text-muted-foreground animate-pulse">Loading comments...</div>
      ) : comments?.length === 0 ? (
        <div className="text-sm text-muted-foreground">No comments yet. Be the first to start the discussion.</div>
      ) : (
        <div className="space-y-4">
          {comments?.map((comment) => (
            <div key={comment.id} className="flex gap-3 group">
              <Avatar className="h-8 w-8 border border-white/10 shrink-0">
                <AvatarImage src={comment.userPhotoUrl || ""} alt={comment.userName} className="object-cover" />
                <AvatarFallback className="bg-background text-primary text-xs font-serif">
                  {comment.userName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 bg-background/50 rounded-2xl rounded-tl-none p-3 border border-white/5">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-sm text-white truncate max-w-[150px]">{comment.userName}</span>
                    {comment.userVerified && <ShieldCheck className="h-3 w-3 text-primary shrink-0" />}
                    <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(comment.createdAt))}</span>
                  </div>
                  {session?.user?.id === comment.userId && (
                    <button
                      onClick={() => deleteComment.mutate({ id: comment.id })}
                      className="text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 p-1"
                      title="Delete comment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-sm text-white/80 whitespace-pre-wrap break-words">{comment.commentText}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 items-end pt-2">
        <Textarea
          placeholder={isAuthed ? "Add a comment..." : "Log in to comment"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!isAuthed || createComment.isPending}
          className="min-h-[44px] h-[44px] resize-none rounded-2xl bg-background/50 border-white/10 focus-visible:ring-primary py-3"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!isAuthed || !text.trim() || createComment.isPending}
          className="h-11 w-11 rounded-full shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
