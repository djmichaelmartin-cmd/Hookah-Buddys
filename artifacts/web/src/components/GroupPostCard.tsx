import { useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThumbsUp, MessageSquare, Bookmark, ShieldCheck, Pin, MoreHorizontal, AlertTriangle, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useReactToGroupPost,
  useToggleGroupPostSave,
  useUpdateGroupPost,
  useDeleteGroupPost,
  useReportGroupPost,
  useListGroupPostComments,
  useCreateGroupPostComment,
  useDeleteGroupPostComment,
  getListGroupPostsQueryKey,
  getListGroupPostCommentsQueryKey,
  useGetCurrentUser,
  type GroupPost,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type GroupPostCardProps = {
  post: GroupPost;
  onLoginPrompt?: () => void;
};

export function GroupPostCard({ post, onLoginPrompt }: GroupPostCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: session } = useGetCurrentUser();
  const [isReacting, setIsReacting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState("");

  const isAuthor = session?.user?.id === post.authorUserId;
  const isGroupAdmin = false; // We would need group role info, assuming not available here or pass down as prop

  const reactMutation = useReactToGroupPost({
    mutation: {
      onMutate: () => setIsReacting(true),
      onSettled: () => setIsReacting(false),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListGroupPostsQueryKey(post.groupId) });
      },
    },
  });

  const saveMutation = useToggleGroupPostSave({
    mutation: {
      onMutate: () => setIsSaving(true),
      onSettled: () => setIsSaving(false),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListGroupPostsQueryKey(post.groupId) });
      },
    },
  });

  const updateMutation = useUpdateGroupPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post updated" });
        queryClient.invalidateQueries({ queryKey: getListGroupPostsQueryKey(post.groupId) });
      },
      onError: () => toast({ title: "Failed to update post", variant: "destructive" })
    }
  });

  const deleteMutation = useDeleteGroupPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post deleted" });
        queryClient.invalidateQueries({ queryKey: getListGroupPostsQueryKey(post.groupId) });
      },
      onError: () => toast({ title: "Failed to delete post", variant: "destructive" })
    }
  });

  const reportMutation = useReportGroupPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post reported" });
      },
      onError: () => toast({ title: "Failed to report post", variant: "destructive" })
    }
  });

  const handleReact = () => {
    if (!reactMutation.isPending && !isReacting) {
      reactMutation.mutate({ groupId: post.groupId, postId: post.id, data: { reactionType: 'like' } });
    }
  };

  const handleSave = () => {
    if (!saveMutation.isPending && !isSaving) {
      saveMutation.mutate({ groupId: post.groupId, postId: post.id });
    }
  };

  const { data: comments, isLoading: loadingComments } = useListGroupPostComments(post.groupId, post.id, {
    query: {
      enabled: showComments,
      queryKey: getListGroupPostCommentsQueryKey(post.groupId, post.id)
    }
  });

  const commentMutation = useCreateGroupPostComment({
    mutation: {
      onSuccess: () => {
        setNewComment("");
        queryClient.invalidateQueries({ queryKey: getListGroupPostCommentsQueryKey(post.groupId, post.id) });
        queryClient.invalidateQueries({ queryKey: getListGroupPostsQueryKey(post.groupId) });
      },
      onError: () => toast({ title: "Failed to post comment", variant: "destructive" })
    }
  });

  const deleteCommentMutation = useDeleteGroupPostComment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Comment deleted" });
        queryClient.invalidateQueries({ queryKey: getListGroupPostCommentsQueryKey(post.groupId, post.id) });
        queryClient.invalidateQueries({ queryKey: getListGroupPostsQueryKey(post.groupId) });
      },
      onError: () => toast({ title: "Failed to delete comment", variant: "destructive" })
    }
  });

  const submitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    commentMutation.mutate({ groupId: post.groupId, postId: post.id, data: { commentText: newComment } });
  };

  return (
    <div className="bg-card border border-white/5 rounded-2xl overflow-hidden shadow-sm transition-all hover:border-white/10 hover-elevate">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Link href={post.authorRole === "doll" ? `/dolls/${post.authorUserId}` : `/members/${post.authorUserId}`}>
              <Avatar className="h-10 w-10 border border-white/10 cursor-pointer">
                <AvatarImage src={post.authorPhotoUrl || ""} />
                <AvatarFallback className="bg-primary/20 text-primary">
                  {post.authorName?.charAt(0) || "U"}
                </AvatarFallback>
              </Avatar>
            </Link>
            <div>
              <Link href={post.authorRole === "doll" ? `/dolls/${post.authorUserId}` : `/members/${post.authorUserId}`}>
                <span className="font-bold text-white hover:text-primary transition-colors cursor-pointer flex items-center gap-1.5">
                  {post.authorName}
                  {post.authorRole === "doll" && <ShieldCheck className="h-3.5 w-3.5 text-primary" />}
                </span>
              </Link>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {post.createdAt ? formatDistanceToNow(new Date(post.createdAt), { addSuffix: true }) : "recently"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {post.isPinned && (
              <div className="bg-primary/20 text-primary rounded-full px-2.5 py-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
                <Pin className="h-3 w-3" /> Pinned
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-white/50 hover:text-white" data-testid="post-options-btn">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-white/10">
                <DropdownMenuItem 
                  onClick={() => reportMutation.mutate({ groupId: post.groupId, postId: post.id, data: { reason: 'Inappropriate content' } })}
                  className="text-white/70 focus:bg-white/10"
                >
                  <AlertTriangle className="h-4 w-4 mr-2" /> Report Post
                </DropdownMenuItem>
                {isAuthor && (
                  <DropdownMenuItem 
                    onClick={() => deleteMutation.mutate({ groupId: post.groupId, postId: post.id })}
                    className="text-destructive focus:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Delete Post
                  </DropdownMenuItem>
                )}
                {/* Admin controls would be here if we had role info */}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="text-white/90 text-[15px] leading-relaxed whitespace-pre-wrap mb-4">
          {post.text}
        </div>

        {post.mediaUrl && (
          <div className="rounded-xl overflow-hidden border border-white/10 bg-black/50 mb-4">
            {post.mediaType === "video" ? (
              <video
                src={post.mediaUrl}
                poster={post.posterUrl || ""}
                controls
                playsInline
                className="w-full max-h-[500px] object-contain"
              />
            ) : (
              <img
                src={post.mediaUrl}
                alt=""
                className="w-full max-h-[500px] object-cover"
                loading="lazy"
              />
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-white/5 text-muted-foreground">
          <div className="flex items-center gap-4">
            <button
              onClick={handleReact}
              disabled={isReacting}
              className={`flex items-center gap-1.5 text-sm transition-colors ${
                post.viewerReaction
                  ? "text-primary hover:text-primary/80"
                  : "hover:text-white"
              }`}
              data-testid="react-btn"
            >
              <ThumbsUp className={`h-4 w-4 ${post.viewerReaction ? "fill-primary" : ""}`} />
              <span className="font-medium">{post.likeCount || 0}</span>
            </button>
            <button
              onClick={() => setShowComments(!showComments)}
              className="flex items-center gap-1.5 text-sm hover:text-white transition-colors"
              data-testid="comment-btn"
            >
              <MessageSquare className="h-4 w-4" />
              <span className="font-medium">{post.commentCount || 0}</span>
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`flex items-center gap-1 text-sm transition-colors ${
              post.viewerSaved
                ? "text-primary hover:text-primary/80"
                : "hover:text-white"
            }`}
            data-testid="save-btn"
          >
            <Bookmark className={`h-4 w-4 ${post.viewerSaved ? "fill-primary" : ""}`} />
          </button>
        </div>
      </div>
      
      {showComments && (
        <div className="bg-background/30 p-4 border-t border-white/5">
          <form onSubmit={submitComment} className="flex gap-2 mb-6">
            <Input 
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a comment..." 
              className="bg-background/50 border-white/10"
              disabled={commentMutation.isPending}
            />
            <Button type="submit" disabled={!newComment.trim() || commentMutation.isPending} data-testid="submit-comment-btn">
              Post
            </Button>
          </form>

          {loadingComments ? (
            <div className="animate-pulse space-y-4">
              <div className="h-10 bg-card/50 rounded-xl" />
              <div className="h-10 bg-card/50 rounded-xl" />
            </div>
          ) : comments && comments.length > 0 ? (
            <div className="space-y-4">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-3">
                  <Avatar className="h-8 w-8 border border-white/10 mt-1 shrink-0">
                    <AvatarImage src={c.userPhotoUrl || ""} />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {c.userName?.charAt(0) || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 bg-card border border-white/5 rounded-2xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-white text-sm">{c.userName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</span>
                        {session?.user?.id === c.userId && (
                          <button 
                            onClick={() => deleteCommentMutation.mutate({ groupId: post.groupId, postId: post.id, commentId: c.id })}
                            className="text-white/40 hover:text-destructive transition-colors"
                            data-testid="delete-comment-btn"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-white/80">{c.commentText}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-4">No comments yet. Be the first to reply!</p>
          )}
        </div>
      )}
    </div>
  );
}
