import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import {
  useListMyGroups,
  useListMyGroupInvites,
  useRespondToGroupInvite,
  useGetCurrentUser,
  getListMyGroupsQueryKey,
  getListMyGroupInvitesQueryKey,
  type GroupInvite,
  type GroupPost,
  type GroupSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Users, Globe, Lock, ShieldCheck, Mail, Check, X, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { GroupPostCard } from "@/components/GroupPostCard";
import { ChevronDown, ChevronRight, Bookmark } from "lucide-react";

function SavedPostsTab({ groups }: { groups: GroupSummary[] }) {
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-white/5 rounded-2xl p-6 text-center mb-6">
        <Bookmark className="w-12 h-12 text-primary mx-auto mb-4" />
        <h3 className="text-xl font-serif text-white mb-2">Saved Group Posts</h3>
        <p className="text-muted-foreground">Select a group below to view posts you've saved in it.</p>
      </div>
      
      {groups.length === 0 ? (
        <p className="text-center text-muted-foreground">You haven't joined or created any groups yet.</p>
      ) : (
        groups.map(group => (
          <div key={group.id} className="bg-card border border-white/10 rounded-xl overflow-hidden">
            <button 
              className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
              onClick={() => setExpandedGroupId(expandedGroupId === group.id ? null : group.id)}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center shrink-0">
                  {group.iconUrl ? <img src={group.iconUrl} className="w-full h-full object-cover rounded" /> : <Users className="w-4 h-4 text-primary" />}
                </div>
                <span className="font-bold text-white">{group.name}</span>
              </div>
              {expandedGroupId === group.id ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
            </button>
            
            {expandedGroupId === group.id && (
              <div className="p-4 border-t border-white/5 bg-background/50">
                <GroupSavedPostsLoader groupId={group.id} />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

import { useListGroupSavedPosts } from "@workspace/api-client-react";

function GroupSavedPostsLoader({ groupId }: { groupId: number }) {
  const { data: posts, isLoading } = useListGroupSavedPosts(groupId);
  
  if (isLoading) return <div className="h-24 animate-pulse bg-card/50 rounded-xl" />;
  if (!posts || posts.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">No saved posts in this group.</p>;
  
  return (
    <div className="space-y-4">
      {posts.map((post: GroupPost) => <GroupPostCard key={post.id} post={post} />)}
    </div>
  );
}

import LoungeLeftSidebar from "@/components/lounge/LoungeLeftSidebar";

export default function DashboardGroups() {
  const { data: session, isLoading: isSessionLoading } = useGetCurrentUser();
  
  if (isSessionLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8 animate-pulse flex h-screen" />
      </Layout>
    );
  }

  if (!session?.authenticated) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 text-center">
          <h2 className="text-2xl font-serif text-white mb-4">Please log in</h2>
          <Link href="/login"><Button>Log In</Button></Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-[1400px]">
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-serif text-4xl text-white font-bold flex items-center gap-3 drop-shadow-md">
              My Groups
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl">
              Manage the groups you've joined, created, or been invited to.
            </p>
          </div>
          <Link href="/groups/create">
            <Button className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] font-bold rounded-full h-11 px-6">
              <Plus className="h-5 w-5 mr-2" /> Create New Group
            </Button>
          </Link>
        </div>

        <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6 lg:items-start">
          <div className="hidden lg:block sticky top-[124px] max-h-[calc(100vh-140px)] overflow-y-auto hide-scrollbar">
            <LoungeLeftSidebar />
          </div>

          <div className="min-w-0">
            <MyGroupsContent />
          </div>
        </div>
      </div>
    </Layout>
  );
}

function MyGroupsContent() {
  const { data: myGroups, isLoading: loadingGroups } = useListMyGroups();
  const { data: invites, isLoading: loadingInvites } = useListMyGroupInvites();
  
  const joined = myGroups?.filter(g => g.viewerMemberRole === 'member') || [];
  const managed = myGroups?.filter(g => g.viewerMemberRole === 'admin' || g.viewerMemberRole === 'owner') || [];
  const requested = myGroups?.filter(g => g.viewerHasPendingRequest) || [];

  return (
    <Tabs defaultValue="joined" className="w-full">
      <TabsList className="bg-card/40 border border-white/5 mb-6 flex flex-wrap h-auto p-1 rounded-2xl backdrop-blur-md">
        <TabsTrigger value="joined" className="rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
          Joined ({joined.length})
        </TabsTrigger>
        <TabsTrigger value="managed" className="rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
          Managing ({managed.length})
        </TabsTrigger>
        <TabsTrigger value="invites" className="rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
          Invites ({invites?.length || 0})
        </TabsTrigger>
        <TabsTrigger value="requests" className="rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
          Pending Requests ({requested.length})
        </TabsTrigger>
        <TabsTrigger value="saved" className="rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
          Saved Posts
        </TabsTrigger>
      </TabsList>

      <TabsContent value="joined">
        {loadingGroups ? <LoadingGrid /> : <GroupGrid groups={joined} emptyMessage="You haven't joined any groups yet." />}
      </TabsContent>

      <TabsContent value="managed">
        {loadingGroups ? <LoadingGrid /> : <GroupGrid groups={managed} emptyMessage="You aren't managing any groups." />}
      </TabsContent>

      <TabsContent value="invites">
        {loadingInvites ? <LoadingGrid /> : <InvitesList invites={invites || []} />}
      </TabsContent>

      <TabsContent value="requests">
        {loadingGroups ? <LoadingGrid /> : <GroupGrid groups={requested} emptyMessage="No pending join requests." />}
      </TabsContent>

      <TabsContent value="saved">
        <SavedPostsTab groups={[...joined, ...managed]} />
      </TabsContent>
    </Tabs>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[1, 2].map((i) => <div key={i} className="h-40 animate-pulse bg-card/50 border border-white/5 rounded-2xl" />)}
    </div>
  );
}

function GroupGrid({ groups, emptyMessage }: { groups: GroupSummary[], emptyMessage: string }) {
  if (groups.length === 0) {
    return (
      <div className="py-24 text-center bg-card/30 border border-white/5 rounded-3xl backdrop-blur-md">
        <Users className="w-12 h-12 mx-auto text-white/20 mb-4" />
        <p className="text-white/60 mb-6">{emptyMessage}</p>
        <Link href="/groups"><Button variant="outline" className="rounded-full">Browse Groups</Button></Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {groups.map(group => (
        <Link key={group.id} href={`/groups/${group.id}`} data-testid={group.viewerHasPendingRequest ? "pending-request-card" : "group-card"}>
          <div className="group relative flex flex-col h-full bg-card border border-white/10 hover:border-primary/50 rounded-2xl overflow-hidden transition-all duration-300 hover-elevate shadow-md cursor-pointer">
            <div className="h-20 bg-[#171A21] relative overflow-hidden shrink-0">
              {group.coverUrl ? (
                <img src={group.coverUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="" />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-secondary/20" />
              )}
            </div>
            <div className="p-4 pt-0 relative flex-grow flex flex-col">
              <div className="h-12 w-12 rounded-xl overflow-hidden border-4 border-card bg-[#171A21] -mt-5 mb-2 shrink-0 flex items-center justify-center shadow-md relative">
                {group.iconUrl ? (
                  <img src={group.iconUrl} className="w-full h-full object-cover" alt="" />
                ) : (
                  <Users className="w-5 h-5 text-white/40" />
                )}
              </div>
              
              <div className="flex-grow">
                <h3 className="text-base font-bold text-white group-hover:text-primary transition-colors line-clamp-1 flex items-center gap-1.5">
                  {group.name}
                  {group.viewerMemberRole === 'owner' && <ShieldCheck className="h-3.5 w-3.5 text-[#D6B56D]" />}
                </h3>
                <p className="text-xs text-white/50 mb-2">{group.memberCount} members</p>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function InvitesList({ invites }: { invites: GroupInvite[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const respond = useRespondToGroupInvite({
    mutation: {
      onSuccess: () => {
        toast({ title: "Invitation updated" });
        queryClient.invalidateQueries({ queryKey: getListMyGroupInvitesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyGroupsQueryKey() });
      },
      onError: () => toast({ title: "Failed to process invitation", variant: "destructive" })
    }
  });

  if (invites.length === 0) {
    return (
      <div className="py-24 text-center bg-card/30 border border-white/5 rounded-3xl backdrop-blur-md">
        <Mail className="w-12 h-12 mx-auto text-white/20 mb-4" />
        <p className="text-white/60">No pending invitations.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {invites.map(invite => (
        <div key={invite.id} className="flex items-center justify-between bg-card border border-white/10 rounded-2xl p-4" data-testid="group-invite-card">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden">
              {invite.group?.iconUrl ? (
                <img src={invite.group.iconUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Users className="h-5 w-5 text-primary" />
              )}
            </div>
            <div>
              <h4 className="font-bold text-white text-sm">
                {invite.group?.name || invite.groupName || `Group ${invite.groupId}`}
              </h4>
              <p className="text-xs text-muted-foreground">
                Invited by {invite.inviterName || invite.invitedByUserName || `user ${invite.inviterId || invite.invitedByUserId}`}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" data-testid="accept-invite-btn" onClick={() => respond.mutate({ groupId: invite.groupId, inviteId: invite.id, data: { action: 'accept' } })} className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 px-3 rounded-full">
              <Check className="h-4 w-4 mr-1" /> Accept
            </Button>
            <Button size="sm" variant="outline" data-testid="decline-invite-btn" onClick={() => respond.mutate({ groupId: invite.groupId, inviteId: invite.id, data: { action: 'decline' } })} className="h-8 px-3 rounded-full border-white/10 hover:bg-white/5">
              <X className="h-4 w-4 mr-1" /> Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
