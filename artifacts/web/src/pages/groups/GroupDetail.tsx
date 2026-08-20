import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import {
  useGetGroup,
  useJoinGroup,
  useLeaveGroup,
  useGetCurrentUser,
  getGetGroupQueryKey,
  type GroupDetail as GroupDetailData,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Users, Lock, Globe, MapPin, AlertCircle, Share2, MoreHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Import subcomponents
import { GroupPosts } from "./components/GroupPosts";
import { GroupEvents } from "./components/GroupEvents";
import { GroupRules } from "./components/GroupRules";
import { GroupMedia } from "./components/GroupMedia";
import { GroupFeatured } from "./components/GroupFeatured";
import { GroupAdmin } from "./components/GroupAdmin";

// Keeping smaller ones inline for simplicity or rewrite them later
import { useListGroupMembers, getListGroupMembersQueryKey, useUpdateGroupMember, useRemoveGroupMember } from "@workspace/api-client-react";

function GroupAbout({ group }: { group: GroupDetailData }) {
  return (
    <div className="bg-card border border-white/10 rounded-2xl p-6">
      <h3 className="text-xl font-serif text-white mb-4">About this Group</h3>
      <div className="prose prose-invert max-w-none">
        <p className="text-white/80 whitespace-pre-wrap">{group.description || "No description provided."}</p>
      </div>
      <div className="mt-6 pt-6 border-t border-white/5 space-y-3">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {group.privacy === 'public' ? <Globe className="w-4 h-4 text-primary" /> : <Lock className="w-4 h-4 text-primary" />}
          <span className="capitalize">{group.privacy} Group</span>
        </div>
        {group.location && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4 text-primary" />
            <span>{group.location}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupMembers({ groupId, isAdmin }: { groupId: number, isAdmin?: boolean }) {
  const { data: members, isLoading } = useListGroupMembers(groupId, { limit: 50 });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const updateMember = useUpdateGroupMember({
    mutation: {
      onSuccess: () => {
        toast({ title: "Member updated" });
        queryClient.invalidateQueries({ queryKey: getListGroupMembersQueryKey(groupId, { limit: 50 }) });
      },
      onError: () => toast({ title: "Failed to update member", variant: "destructive" })
    }
  });

  const removeMember = useRemoveGroupMember({
    mutation: {
      onSuccess: () => {
        toast({ title: "Member removed" });
        queryClient.invalidateQueries({ queryKey: getListGroupMembersQueryKey(groupId, { limit: 50 }) });
      },
      onError: () => toast({ title: "Failed to remove member", variant: "destructive" })
    }
  });

  if (isLoading) return <div className="p-6 bg-card border border-white/10 rounded-2xl animate-pulse h-32" />;
  if (!members || members.length === 0) return <div className="p-12 bg-card border border-white/10 rounded-2xl text-center text-muted-foreground">No members found.</div>;

  return (
    <div className="bg-card border border-white/10 rounded-2xl p-6">
      <h3 className="text-xl font-serif text-white mb-6">Members</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {members.map(member => (
          <div key={member.id} className="flex items-center justify-between gap-4 bg-background/30 p-3 rounded-xl border border-white/5">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 overflow-hidden shrink-0">
                {member.userPhotoUrl ? <img src={member.userPhotoUrl} className="w-full h-full object-cover" /> : <Users className="w-6 h-6 m-auto mt-3 text-primary/50" />}
              </div>
              <div>
                <p className="font-bold text-white text-sm">{member.userName}</p>
                <p className="text-xs text-muted-foreground capitalize">{member.role}</p>
              </div>
            </div>
            {isAdmin && member.role !== 'owner' && (
              <div className="flex gap-2">
                {member.role !== 'admin' && (
                  <Button size="sm" variant="ghost" onClick={() => updateMember.mutate({ groupId, userId: member.userId, data: { role: 'admin' } })} disabled={updateMember.isPending}>Make Admin</Button>
                )}
                {member.role === 'admin' && (
                  <Button size="sm" variant="ghost" onClick={() => updateMember.mutate({ groupId, userId: member.userId, data: { role: 'member' } })} disabled={updateMember.isPending}>Demote</Button>
                )}
                <Button size="sm" variant="outline" className="border-destructive text-destructive hover:bg-destructive hover:text-white" onClick={() => removeMember.mutate({ groupId, userId: member.userId })} disabled={removeMember.isPending}>Kick</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useListGroupEvents, useRsvpGroupEvent, getListGroupEventsQueryKey } from "@workspace/api-client-react";
import { CalendarDays } from "lucide-react";

// Replaced by import GroupEvents from "./components/GroupEvents";
function OldGroupEvents({ groupId }: { groupId: number }) {
  const { data: events, isLoading } = useListGroupEvents(groupId, { limit: 20 });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const rsvpMutation = useRsvpGroupEvent({
    mutation: {
      onSuccess: () => {
        toast({ title: "RSVP updated" });
        queryClient.invalidateQueries({ queryKey: getListGroupEventsQueryKey(groupId, { limit: 20 }) }); 
      },
      onError: () => toast({ title: "Failed to update RSVP", variant: "destructive" })
    }
  });

  if (isLoading) return <div className="p-6 bg-card border border-white/10 rounded-2xl animate-pulse h-32" />;
  if (!events || events.length === 0) {
    return (
      <div className="p-12 bg-card border border-white/10 rounded-2xl text-center">
        <CalendarDays className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
        <p className="text-muted-foreground">No upcoming events for this group.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-white/10 rounded-2xl p-6">
      <h3 className="text-xl font-serif text-white mb-6">Events</h3>
      <div className="space-y-4">
        {events.map(event => (
          <div key={event.id} className="bg-background/30 border border-white/5 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-white mb-1">{event.title}</h4>
              <p className="text-xs text-primary mb-2">{new Date(event.startsAt).toLocaleString()}</p>
              {event.description && <p className="text-sm text-white/70 mb-3">{event.description}</p>}
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {event.location || "TBD"}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" onClick={() => rsvpMutation.mutate({ groupId, eventId: event.id, data: { rsvpStatus: 'going' } })} disabled={rsvpMutation.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">Going</Button>
              <Button size="sm" variant="outline" onClick={() => rsvpMutation.mutate({ groupId, eventId: event.id, data: { rsvpStatus: 'interested' } })} disabled={rsvpMutation.isPending} className="border-white/10 hover:bg-white/5">Interested</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useListGroupQuestions, getListGroupQuestionsQueryKey } from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";

function JoinGroupDialog({
  groupId,
  isPrivate,
  isOpen,
  onOpenChange,
  onSuccess,
}: {
  groupId: number;
  isPrivate: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { data: questions, isLoading } = useListGroupQuestions(groupId, { query: { enabled: isOpen, queryKey: getListGroupQuestionsQueryKey(groupId) } });
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const { toast } = useToast();
  const joinGroup = useJoinGroup({
    mutation: {
      onSuccess: (result) => {
        toast({ title: result.status === "joined" ? "Joined group" : "Request sent" });
        onOpenChange(false);
        onSuccess();
      },
      onError: () => toast({ title: "Failed to send request", variant: "destructive" })
    }
  });

  const handleJoin = () => {
    if (!questions || questions.length === 0) {
      joinGroup.mutate({ groupId });
      return;
    }
    const answersPayload = Object.entries(answers).map(([qId, ans]) => ({
      questionId: parseInt(qId),
      answerText: ans
    }));
    joinGroup.mutate({ groupId, data: { answers: answersPayload } });
  };

  const hasRequiredUnanswered = questions?.some(q => q.isRequired && !answers[q.id]?.trim());

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border border-white/10 sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif text-white">
            {isPrivate ? "Request to Join" : "Join Group"}
          </DialogTitle>
          <DialogDescription>
            {questions && questions.length > 0
              ? "Please answer the following questions to join this group."
              : isPrivate
                ? "Send a membership request to the Group admins."
                : "Are you sure you want to join this group?"}
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          {isLoading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-20 bg-background/50 rounded-xl" />
              <div className="h-20 bg-background/50 rounded-xl" />
            </div>
          ) : questions && questions.length > 0 ? (
            questions.map(q => (
              <div key={q.id} className="space-y-2">
                <label className="text-sm font-medium text-white">{q.questionText} {q.isRequired && <span className="text-destructive">*</span>}</label>
                <Textarea 
                  value={answers[q.id] || ""} 
                  onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })} 
                  className="bg-background/50 border-white/10" 
                  placeholder="Your answer..."
                  data-testid={`join-question-${q.id}`}
                />
              </div>
            ))
          ) : null}
        </div>
        
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleJoin} disabled={joinGroup.isPending || hasRequiredUnanswered} data-testid="submit-join-request-btn">
            {joinGroup.isPending ? "Sending..." : isPrivate ? "Submit Request" : "Join Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useListGroupSavedPosts } from "@workspace/api-client-react";
import { GroupPostCard } from "@/components/GroupPostCard";

function GroupSavedPosts({ groupId }: { groupId: number }) {
  const { data: posts, isLoading } = useListGroupSavedPosts(groupId);
  if (isLoading) return <div className="animate-pulse h-32 bg-card border border-white/5 rounded-2xl" />;
  if (!posts || posts.length === 0) return <div className="p-12 text-center border border-white/5 rounded-2xl bg-card"><p className="text-muted-foreground">You haven't saved any posts in this group.</p></div>;

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-serif text-white mb-4">Saved Posts</h3>
      {posts.map(post => <GroupPostCard key={post.id} post={post} />)}
    </div>
  );
}


export default function GroupDetail() {
  const [match, params] = useRoute("/groups/:id/:tab?");
  const groupId = parseInt(params?.id || "0", 10);
  const currentTab = params?.tab || "posts";
  const [_, setLocation] = useLocation();
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useGetCurrentUser();
  const { data: group, isLoading, isError } = useGetGroup(groupId, {
    query: { enabled: !!groupId, queryKey: getGetGroupQueryKey(groupId) },
  });

  const leaveGroup = useLeaveGroup({
    mutation: {
      onSuccess: () => {
        toast({ title: "Left group" });
        queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to leave group", variant: "destructive" })
    }
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8 max-w-5xl animate-pulse">
          <div className="h-48 md:h-64 bg-card/50 rounded-3xl mb-6 border border-white/10" />
          <div className="flex gap-4">
            <div className="w-2/3 space-y-4">
              <div className="h-32 bg-card/50 rounded-2xl border border-white/10" />
              <div className="h-64 bg-card/50 rounded-2xl border border-white/10" />
            </div>
            <div className="w-1/3">
              <div className="h-64 bg-card/50 rounded-2xl border border-white/10 sticky top-24" />
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (isError || !group) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 text-center max-w-2xl">
          <div className="bg-card/50 border border-white/5 rounded-3xl p-12">
            <AlertCircle className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <h2 className="text-2xl font-serif text-white mb-2">Group not found</h2>
            <p className="text-muted-foreground mb-6">This group may have been deleted or is private.</p>
            <Button onClick={() => setLocation("/groups")}>Back to Groups</Button>
          </div>
        </div>
      </Layout>
    );
  }

  const isMember = !!(group.viewerMemberRole && group.viewerMemberRole !== "none" && group.viewerMemberRole !== "invited" && group.viewerMemberRole !== "requested");
  const isAdmin = group.viewerMemberRole === "owner" || group.viewerMemberRole === "admin";
  const isPending = group.viewerHasPendingRequest;

  const handleJoinLeave = () => {
    if (!session?.authenticated) {
      setLocation("/login");
      return;
    }
    if (isPending) {
      return;
    }
    if (isMember) {
      leaveGroup.mutate({ groupId });
    } else {
      setIsJoinDialogOpen(true);
    }
  };

  
  let baseTabs = [
    { id: "about", label: "About" },
  ];

  if (isMember || group.privacy === 'public') {
    baseTabs = [
      { id: "posts", label: "Posts" },
      { id: "about", label: "About" },
      { id: "members", label: "Members" },
      { id: "events", label: "Events" },
      { id: "media", label: "Media" },
      { id: "rules", label: "Rules" },
      { id: "featured", label: "Featured" },
    ];
  }


  if (isMember) {
    baseTabs.push({ id: "saved", label: "Saved Posts" });
  }

  if (isAdmin) {
    baseTabs.push({ id: "admin", label: "Admin Tools" });
  }

  const mediaTabs = [
    "media",
    "photos",
    "videos",
    "reels",
    "files",
    // Backward-compatible aliases from the first Groups UI pass.
    "photo",
    "video",
    "reel",
    "file",
  ];
  const adminTabs = ["admin", "settings", "member-requests", "reported-content", "insights"];
  
  const activeMainTab = mediaTabs.includes(currentTab) ? "media" : adminTabs.includes(currentTab) ? "admin" : (!isMember && group.privacy === "private" && !params?.tab) ? "about" : currentTab;

  return (
    <Layout>
      <JoinGroupDialog
        groupId={groupId}
        isPrivate={group.privacy === "private"}
        isOpen={isJoinDialogOpen}
        onOpenChange={setIsJoinDialogOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) });
        }}
      />
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header / Cover */}
        <div className="relative rounded-3xl overflow-hidden mb-6 bg-[#171A21] border border-white/10 shadow-lg">
          <div className="h-48 md:h-64 relative">
            {group.coverUrl ? (
              <img src={group.coverUrl} className="w-full h-full object-cover" alt="" />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-secondary/20" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            
            <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="flex items-end gap-5">
                <div className="w-24 h-24 md:w-32 md:h-32 rounded-2xl bg-background border-4 border-[#171A21] overflow-hidden shrink-0 shadow-xl relative z-10 flex items-center justify-center">
                  {group.iconUrl ? <img src={group.iconUrl} className="w-full h-full object-cover" alt="" /> : <Users className="w-10 h-10 text-white/30" />}
                </div>
                <div className="pb-2 md:pb-4">
                  <h1 className="text-3xl md:text-4xl font-serif font-bold text-white mb-2 drop-shadow-md">{group.name}</h1>
                  <p className="text-white/80 font-medium flex items-center gap-2">
                    {group.privacy === "public" ? <Globe className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                    {group.privacy === "public" ? "Public" : "Private"} Group • {group.memberCount} members
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <Button 
                  onClick={handleJoinLeave}
                  data-testid="join-leave-group-btn"
                  disabled={isPending || leaveGroup.isPending}
                  className={`rounded-full font-bold px-8 ${
                    isMember 
                      ? "bg-white/10 hover:bg-white/20 text-white border border-white/20"
                      : isPending
                      ? "bg-orange-500/20 text-orange-500 hover:bg-orange-500/30"
                      : "bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(214,181,109,0.3)]"
                  }`}
                >
                  {isMember ? "Joined" : isPending ? "Request Pending" : group.privacy === "private" ? "Request to Join" : "Join Group"}
                </Button>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="rounded-full bg-black/40 border-white/20 hover:bg-white/10 backdrop-blur-md">
                      <MoreHorizontal className="w-5 h-5 text-white" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 bg-card border border-white/10 shadow-xl rounded-xl">
                    <DropdownMenuItem className="focus:bg-white/10 cursor-pointer">
                      <Share2 className="w-4 h-4 mr-2" /> Share Group
                    </DropdownMenuItem>
                    {!isAdmin && (
                      <DropdownMenuItem className="text-destructive focus:bg-destructive/10 cursor-pointer">
                        <AlertCircle className="w-4 h-4 mr-2" /> Report Group
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex overflow-x-auto hide-scrollbar gap-2 mb-8 pb-2 border-b border-white/10">
          {baseTabs.map((tab) => (
            <Link key={tab.id} href={`/groups/${groupId}${tab.id === 'posts' ? '' : `/${tab.id}`}`}>
              <button
                className={`whitespace-nowrap px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeMainTab === tab.id
                    ? "bg-white text-background shadow-md"
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            </Link>
          ))}
        </div>

        {/* Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {activeMainTab === "posts" && <GroupPosts groupId={groupId} isMember={isMember} isAdmin={isAdmin} group={group} />}
            {activeMainTab === "about" && <GroupAbout group={group} />}
            {activeMainTab === "members" && <GroupMembers groupId={groupId} isAdmin={isAdmin} />}
            {activeMainTab === "events" && <GroupEvents groupId={groupId} isAdmin={isAdmin} />}
            {activeMainTab === "media" && (
              <GroupMedia
                groupId={groupId}
                kind={currentTab}
                canUpload={isMember}
                canDelete={isAdmin}
              />
            )}
            {activeMainTab === "rules" && <GroupRules groupId={groupId} isAdmin={isAdmin} />}
            {activeMainTab === "featured" && <GroupFeatured groupId={groupId} isAdmin={isAdmin} />}
            {activeMainTab === "saved" && isMember && <GroupSavedPosts groupId={groupId} />}
            {activeMainTab === "admin" && isAdmin && <GroupAdmin groupId={groupId} group={group} currentTab={currentTab} />}
          </div>

          <div className="space-y-6">
            <div className="bg-card border border-white/10 rounded-2xl p-5 shadow-sm">
              <h3 className="font-serif text-lg text-white mb-3">About</h3>
              <p className="text-sm text-white/70 mb-4 leading-relaxed">
                {group.description || "Welcome to our HookahBuddys group!"}
              </p>
              
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-white/40" />
                  <span>{group.memberCount} Members</span>
                </div>
                {group.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-white/40" />
                    <span>{group.location}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-white/40" />
                  <span className="capitalize">{group.privacy} Group</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </Layout>
  );
}
