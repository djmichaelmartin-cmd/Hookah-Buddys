import { useState } from "react";
import { 
  useListGroupPosts,
  useApproveGroupPost,
  useRejectGroupPost,
  getListGroupPostsQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Lock, ShieldCheck, Check, X } from "lucide-react";
import { GroupPostCard } from "@/components/GroupPostCard";
import { CreateGroupPostForm } from "@/components/CreateGroupPostForm";

export function GroupPosts({ groupId, isMember, isAdmin, group }: { groupId: number; isMember: boolean; isAdmin: boolean; group: any }) {
  const { data: posts, isLoading } = useListGroupPosts(groupId, { limit: 20 });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const approvePost = useApproveGroupPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post approved" });
        queryClient.invalidateQueries({ queryKey: getListGroupPostsQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to approve post", variant: "destructive" })
    }
  });

  const rejectPost = useRejectGroupPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post rejected" });
        queryClient.invalidateQueries({ queryKey: getListGroupPostsQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to reject post", variant: "destructive" })
    }
  });

  if (group.privacy === 'private' && !isMember) {
    return (
      <div className="bg-card/50 border border-white/5 rounded-3xl p-12 text-center">
        <Lock className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
        <h3 className="text-xl font-serif text-white mb-2">This group is private</h3>
        <p className="text-muted-foreground">Join the group to see posts and participate in discussions.</p>
      </div>
    );
  }

  const pendingPosts = posts?.filter(p => p.status === 'pending_approval') || [];
  const activePosts = posts?.filter(p => p.status === 'active') || [];

  return (
    <div className="space-y-6">
      {isMember && (
        <CreateGroupPostForm groupId={groupId} />
      )}

      {isAdmin && pendingPosts.length > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-6 mb-6">
          <h3 className="text-lg font-serif text-orange-400 mb-4 flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Pending Posts ({pendingPosts.length})</h3>
          <div className="space-y-4">
            {pendingPosts.map((post) => (
              <div key={post.id} className="relative">
                <GroupPostCard post={post} />
                <div className="absolute top-2 right-2 flex gap-2">
                  <Button size="sm" className="bg-green-500 hover:bg-green-600 text-white" onClick={() => approvePost.mutate({ groupId, postId: post.id })} disabled={approvePost.isPending} data-testid="approve-post-btn"><Check className="w-4 h-4 mr-1" /> Approve</Button>
                  <Button size="sm" variant="destructive" onClick={() => rejectPost.mutate({ groupId, postId: post.id, data: { reason: "Declined by admin" } })} disabled={rejectPost.isPending} data-testid="reject-post-btn"><X className="w-4 h-4 mr-1" /> Reject</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-white/5 rounded-2xl h-48 animate-pulse" />
          ))}
        </div>
      ) : activePosts.length === 0 ? (
        <div className="bg-card/30 border border-white/5 rounded-3xl p-12 text-center">
          <h3 className="text-lg font-serif text-white mb-2">No posts yet</h3>
          <p className="text-muted-foreground">Be the first to start the discussion!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activePosts.map((post) => (
            <GroupPostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
