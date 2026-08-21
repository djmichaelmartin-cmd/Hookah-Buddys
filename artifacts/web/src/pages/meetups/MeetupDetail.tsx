import { useState, useCallback } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import {
  useGetGroup,
  useLeaveGroup,
  useGetCurrentUser,
  getGetGroupQueryKey,
  useJoinGroup,
  useListGroupQuestions,
  getListGroupQuestionsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Users, Lock, Globe, MapPin, AlertCircle, Share2, MoreHorizontal, Tent, CalendarPlus, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import { GroupPosts } from "@/pages/groups/components/GroupPosts";
import { GroupEvents } from "@/pages/groups/components/GroupEvents";
import { GroupRules } from "@/pages/groups/components/GroupRules";
import { GroupMedia } from "@/pages/groups/components/GroupMedia";
import { GroupAdmin } from "@/pages/groups/components/GroupAdmin";
import { GroupFeatured } from "@/pages/groups/components/GroupFeatured";
import { useListGroupMembers, getListGroupMembersQueryKey, useUpdateGroupMember, useRemoveGroupMember } from "@workspace/api-client-react";

function JoinMeetupDialog({
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
        toast({ title: result.status === "joined" ? "Joined meetup" : "Request sent" });
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
      <DialogContent className="bg-card border border-orange-500/20 sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif text-white">
            {isPrivate ? "Request to Join Meetup" : "Join Meetup"}
          </DialogTitle>
          <DialogDescription>
            {questions && questions.length > 0
              ? "Please answer the following questions to join."
              : isPrivate
                ? "Send a request to the organizers."
                : "Are you sure you want to join this meetup?"}
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
                  className="bg-background/50 border-white/10 focus-visible:ring-orange-500" 
                  placeholder="Your answer..."
                />
              </div>
            ))
          ) : null}
        </div>
        
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-orange-600 hover:bg-orange-500 text-white" onClick={handleJoin} disabled={joinGroup.isPending || hasRequiredUnanswered}>
            {joinGroup.isPending ? "Sending..." : isPrivate ? "Submit Request" : "Join Meetup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function mapRole(role?: string | null) {
  if (role === 'owner') return 'Organizer';
  if (role === 'admin') return 'Co-host';
  if (role === 'moderator') return 'Assistant Organizer';
  return role || 'Member';
}

function MeetupMembers({ groupId, isAdmin }: { groupId: number, isAdmin?: boolean }) {
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
  if (!members || members.length === 0) return <div className="p-12 bg-card border border-orange-500/10 rounded-2xl text-center text-muted-foreground">No members found.</div>;

  return (
    <div className="bg-card border border-orange-500/10 rounded-2xl p-6">
      <h3 className="text-xl font-serif text-orange-400 mb-6">RSVPs & Members</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {members.map(member => (
          <div key={member.id} className="flex items-center justify-between gap-4 bg-background/30 p-3 rounded-xl border border-white/5">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-orange-500/10 overflow-hidden shrink-0">
                {member.userPhotoUrl ? <img src={member.userPhotoUrl} className="w-full h-full object-cover" /> : <Users className="w-6 h-6 m-auto mt-3 text-orange-500/50" />}
              </div>
              <div>
                <p className="font-bold text-white text-sm">{member.userName}</p>
                <p className="text-xs text-orange-500/80 capitalize">{mapRole(member.role)}</p>
              </div>
            </div>
            {isAdmin && member.role !== 'owner' && (
              <div className="flex gap-2">
                {member.role !== 'admin' && (
                  <Button size="sm" variant="ghost" onClick={() => updateMember.mutate({ groupId, userId: member.userId, data: { role: 'admin' } })} disabled={updateMember.isPending}>Make Co-host</Button>
                )}
                {member.role === 'admin' && (
                  <Button size="sm" variant="ghost" onClick={() => updateMember.mutate({ groupId, userId: member.userId, data: { role: 'member' } })} disabled={updateMember.isPending}>Remove Co-host</Button>
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

export default function MeetupDetail() {
  const [match, params] = useRoute("/meetups/:id/:tab?");
  const groupId = parseInt(params?.id || "0", 10);
  const currentTab = params?.tab || "events"; // Default to events for meetups
  const [_, setLocation] = useLocation();
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useGetCurrentUser();
  const { data: group, isLoading, isError } = useGetGroup(groupId, {
    query: { enabled: !!groupId, queryKey: getGetGroupQueryKey(groupId) },
  });

  const leaveGroup = useLeaveGroup({
    mutation: {
      onSuccess: () => {
        toast({ title: "Left meetup" });
        queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to leave", variant: "destructive" })
    }
  });

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: group?.name || "Hookah Meetup",
          url: url,
        });
        toast({ title: "Shared successfully!" });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          navigator.clipboard.writeText(url);
          setCopied(true);
          toast({ title: "Link copied to clipboard" });
          setTimeout(() => setCopied(false), 2000);
        }
      }
    } else {
      navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: "Link copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    }
  }, [group, toast]);

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

  if (isError || !group || group.groupType !== 'meetup') {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 text-center max-w-2xl">
          <div className="bg-card/50 border border-white/5 rounded-3xl p-12">
            <AlertCircle className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <h2 className="text-2xl font-serif text-white mb-2">Meetup not found</h2>
            <p className="text-muted-foreground mb-6">This meetup may have been deleted, is private, or is not a meetup.</p>
            <Button onClick={() => setLocation("/meetups")}>Back to Meetups</Button>
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
    if (isPending) return;
    if (isMember) {
      leaveGroup.mutate({ groupId });
    } else {
      setIsJoinDialogOpen(true);
    }
  };

  let baseTabs = [
    { id: "events", label: "Events" },
    { id: "about", label: "About" },
  ];

  if (isMember || group.privacy === 'public') {
    baseTabs = [
      { id: "events", label: "Upcoming Events" },
      { id: "posts", label: "Discussions" },
      { id: "members", label: "RSVPs" },
      { id: "media", label: "Photos" },
      { id: "rules", label: "Rules" },
    ];
  }

  if (isAdmin) {
    baseTabs.push({ id: "admin", label: "Organizer Tools" });
  }

  const mediaTabs = ["media", "photos", "videos", "reels", "files", "photo", "video", "reel", "file"];
  const adminTabs = ["admin", "settings", "member-requests", "reported-content", "insights"];
  
  const activeMainTab = mediaTabs.includes(currentTab) ? "media" : adminTabs.includes(currentTab) ? "admin" : (!isMember && group.privacy === "private" && !params?.tab) ? "about" : currentTab;

  return (
    <Layout>
      <JoinMeetupDialog
        groupId={groupId}
        isPrivate={group.privacy === "private"}
        isOpen={isJoinDialogOpen}
        onOpenChange={setIsJoinDialogOpen}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) })}
      />
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="relative rounded-3xl overflow-hidden mb-6 bg-[#171A21] border border-orange-500/20 shadow-lg">
          <div className="h-48 md:h-64 relative">
            {group.coverUrl ? (
              <img src={group.coverUrl} className="w-full h-full object-cover" alt="" />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/30 to-amber-500/30" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
            
            <div className="absolute top-4 left-4">
              <span className="px-3 py-1 rounded-full bg-orange-500 text-white text-xs font-bold uppercase tracking-wider shadow-lg">
                Meetup
              </span>
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="flex items-end gap-5">
                <div className="pb-2 md:pb-4">
                  <h1 className="text-3xl md:text-5xl font-serif font-bold text-white mb-2 drop-shadow-md">{group.name}</h1>
                  <p className="text-orange-400 font-medium flex items-center gap-3">
                    <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {group.location || "Location TBD"}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1.5">
                      {group.privacy === "public" ? <Globe className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                      {group.privacy === "public" ? "Public" : "Private"} 
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {group.memberCount} members</span>
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                {isAdmin && (
                  <Link href={`/meetups/${groupId}/create-event`}>
                    <Button className="rounded-full font-bold px-6 bg-orange-600 hover:bg-orange-500 text-white shadow-[0_0_15px_rgba(249,115,22,0.4)]">
                      <CalendarPlus className="w-4 h-4 mr-2" /> Plan Event
                    </Button>
                  </Link>
                )}
                
                <Button 
                  onClick={handleJoinLeave}
                  disabled={isPending || leaveGroup.isPending}
                  className={`rounded-full font-bold px-8 ${
                    isMember 
                      ? "bg-white/10 hover:bg-white/20 text-white border border-white/20"
                      : isPending
                      ? "bg-orange-500/20 text-orange-500 hover:bg-orange-500/30"
                      : "bg-orange-600 hover:bg-orange-500 text-white shadow-[0_0_20px_rgba(249,115,22,0.3)]"
                  }`}
                >
                  {isMember ? "Joined" : isPending ? "Request Pending" : group.privacy === "private" ? "Request to Join" : "Join Meetup"}
                </Button>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="rounded-full bg-black/40 border-white/20 hover:bg-white/10 backdrop-blur-md">
                      <MoreHorizontal className="w-5 h-5 text-white" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 bg-card border border-white/10 shadow-xl rounded-xl">
                    <DropdownMenuItem className="focus:bg-white/10 cursor-pointer" onClick={handleShare}>
                      {copied ? <Check className="w-4 h-4 mr-2 text-green-400" /> : <Share2 className="w-4 h-4 mr-2" />} 
                      {copied ? "Copied!" : "Share Meetup"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>

        <div className="flex overflow-x-auto hide-scrollbar gap-2 mb-8 pb-2 border-b border-orange-500/20">
          {baseTabs.map((tab) => (
            <Link key={tab.id} href={`/meetups/${groupId}${tab.id === 'events' ? '' : `/${tab.id}`}`}>
              <button
                className={`whitespace-nowrap px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeMainTab === tab.id
                    ? "bg-orange-500 text-white shadow-md"
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {activeMainTab === "events" && <GroupEvents groupId={groupId} isAdmin={isAdmin} isMeetup={true} />}
            {activeMainTab === "posts" && <GroupPosts groupId={groupId} isMember={isMember} isAdmin={isAdmin} group={group} />}
            {activeMainTab === "about" && (
              <div className="bg-card border border-orange-500/10 rounded-2xl p-6">
                <h3 className="text-xl font-serif text-orange-400 mb-4">About this Meetup</h3>
                <div className="prose prose-invert max-w-none text-white/80">
                  {group.description}
                </div>
              </div>
            )}
            {activeMainTab === "members" && <MeetupMembers groupId={groupId} isAdmin={isAdmin} />}
            {activeMainTab === "media" && (
              <GroupMedia
                groupId={groupId}
                kind={currentTab}
                canUpload={isMember}
                canDelete={isAdmin}
              />
            )}
            {activeMainTab === "rules" && <GroupRules groupId={groupId} isAdmin={isAdmin} />}
            {activeMainTab === "admin" && isAdmin && <GroupAdmin groupId={groupId} group={group} currentTab={currentTab} />}
          </div>

          <div className="space-y-6">
            <div className="bg-card border border-orange-500/10 rounded-2xl p-5 shadow-sm">
              <h3 className="font-serif text-lg text-orange-400 mb-3">About</h3>
              <p className="text-sm text-white/70 mb-4 leading-relaxed line-clamp-4">
                {group.description || "Join us for hookah sessions!"}
              </p>
              
              <div className="space-y-3 text-sm text-muted-foreground pt-4 border-t border-white/5">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-orange-400/50" />
                  <span>{group.memberCount} Members</span>
                </div>
                {group.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-orange-400/50" />
                    <span>{group.location}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-orange-400/50" />
                  <span className="capitalize">{group.privacy} Meetup</span>
                </div>
              </div>
            </div>
            
            {group.tags && group.tags.length > 0 && (
              <div className="bg-card border border-orange-500/10 rounded-2xl p-5 shadow-sm">
                <h3 className="font-serif text-lg text-white mb-3">Interests</h3>
                <div className="flex flex-wrap gap-2">
                  {group.tags.map(tag => (
                    <span key={tag} className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white/70">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
