import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import {
  useListMyGroups,
  useListMyGroupInvites,
  useRespondToGroupInvite,
  useDeleteMeetupDraft,
  useGetCurrentUser,
  getListMyGroupsQueryKey,
  getListMyGroupInvitesQueryKey,
  type GroupInvite,
  type GroupSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trackEvent } from "@/lib/analytics";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import LoungeLeftSidebar from "@/components/lounge/LoungeLeftSidebar";
import { Users, Globe, Lock, ShieldCheck, Mail, Check, X, Plus, CalendarDays, MapPin, FileEdit, Trash2 } from "lucide-react";

export default function DashboardMeetups() {
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
          <Link href="/login"><Button className="bg-orange-600 hover:bg-orange-500">Log In</Button></Link>
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
              <span className="text-orange-500">My</span> Meetups
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl">
              Manage the meetups you've joined, created, or been invited to.
            </p>
          </div>
          <Link href="/meetups/create">
            <Button className="bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-full h-11 px-6 shadow-[0_0_15px_rgba(249,115,22,0.4)]">
              <Plus className="h-5 w-5 mr-2" /> Start a Meetup
            </Button>
          </Link>
        </div>

        <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6 lg:items-start">
          <div className="hidden lg:block sticky top-[124px] max-h-[calc(100vh-140px)] overflow-y-auto hide-scrollbar">
            <LoungeLeftSidebar />
          </div>

          <div className="min-w-0">
            <MyMeetupsContent />
          </div>
        </div>
      </div>
    </Layout>
  );
}

function MyMeetupsContent() {
  const { data: myGroups, isLoading: loadingGroups } = useListMyGroups();
  const { data: invites, isLoading: loadingInvites } = useListMyGroupInvites();
  
  const allMeetups = myGroups?.filter(g => g.groupType === 'meetup') || [];
  const meetupInvites = invites?.filter(i => i.group?.groupType === 'meetup') || [];

  const drafts = allMeetups.filter(g => g.status === 'draft' && g.viewerMemberRole === 'owner');
  const publishedMeetups = allMeetups.filter(g => g.status !== 'draft');
  const joined = publishedMeetups.filter(g => g.viewerMemberRole === 'member');
  const managed = publishedMeetups.filter(g => g.viewerMemberRole === 'admin' || g.viewerMemberRole === 'owner');
  const requested = publishedMeetups.filter(g => g.viewerHasPendingRequest);

  return (
    <Tabs defaultValue="joined" className="w-full">
      <TabsList className="bg-card/40 border border-orange-500/20 mb-6 flex flex-wrap h-auto p-1 rounded-2xl backdrop-blur-md">
        <TabsTrigger value="joined" className="rounded-xl data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
          Joined ({joined.length})
        </TabsTrigger>
        <TabsTrigger value="managed" className="rounded-xl data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
          Organizing ({managed.length})
        </TabsTrigger>
        <TabsTrigger value="drafts" className="rounded-xl data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
          Drafts ({drafts.length})
        </TabsTrigger>
        <TabsTrigger value="invites" className="rounded-xl data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
          Invites ({meetupInvites.length})
        </TabsTrigger>
        <TabsTrigger value="requests" className="rounded-xl data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
          Pending Requests ({requested.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="joined">
        {loadingGroups ? <LoadingGrid /> : <MeetupGrid meetups={joined} emptyMessage="You haven't joined any meetups yet." />}
      </TabsContent>

      <TabsContent value="managed">
        {loadingGroups ? <LoadingGrid /> : <MeetupGrid meetups={managed} emptyMessage="You aren't organizing any meetups." />}
      </TabsContent>

      <TabsContent value="drafts">
        {loadingGroups ? <LoadingGrid /> : <DraftGrid drafts={drafts} />}
      </TabsContent>

      <TabsContent value="invites">
        {loadingInvites ? <LoadingGrid /> : <InvitesList invites={meetupInvites} />}
      </TabsContent>

      <TabsContent value="requests">
        {loadingGroups ? <LoadingGrid /> : <MeetupGrid meetups={requested} emptyMessage="No pending join requests." />}
      </TabsContent>
    </Tabs>
  );
}

function DraftGrid({ drafts }: { drafts: GroupSummary[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const discardDraft = useDeleteMeetupDraft({
    mutation: {
      onSuccess: () => {
        toast({ title: "Meetup draft discarded" });
        queryClient.invalidateQueries({ queryKey: getListMyGroupsQueryKey() });
      },
      onError: () => {
        toast({
          title: "Could not discard draft",
          description: "Please try again in a moment.",
          variant: "destructive",
        });
      },
    },
  });

  if (drafts.length === 0) {
    return (
      <div className="py-24 text-center bg-card/30 border border-orange-500/10 rounded-3xl backdrop-blur-md">
        <FileEdit className="w-14 h-14 mx-auto text-orange-500/30 mb-4" />
        <p className="text-white/60 mb-6">You have no unfinished Meetup drafts.</p>
        <Link href="/meetups/create">
          <Button variant="outline" className="rounded-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10">
            Start a Meetup
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {drafts.map((draft) => (
        <div key={draft.id} className="flex flex-col bg-card border border-orange-500/20 rounded-2xl overflow-hidden shadow-md">
          <div className="h-24 bg-[#171A21] relative overflow-hidden">
            {draft.coverUrl ? (
              <img src={draft.coverUrl} className="w-full h-full object-cover" alt="" />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-amber-500/10" />
            )}
            <span className="absolute top-3 left-3 rounded-full bg-black/70 px-3 py-1 text-xs font-bold text-orange-300">
              Draft
            </span>
          </div>
          <div className="p-4 flex flex-col flex-1">
            <h3 className="text-lg font-bold text-white line-clamp-1">{draft.name || "Untitled Meetup"}</h3>
            <p className="text-xs text-white/50 mt-1 mb-4">
              Last saved {draft.updatedAt ? new Date(draft.updatedAt).toLocaleDateString() : new Date(draft.createdAt).toLocaleDateString()}
            </p>
            <div className="mt-auto flex gap-2">
              <Link href={`/meetups/create?draftId=${draft.id}`} className="flex-1">
                <Button className="w-full rounded-full bg-orange-600 hover:bg-orange-500 text-white font-bold">
                  <FileEdit className="w-4 h-4 mr-2" /> Continue
                </Button>
              </Link>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0 rounded-full border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    aria-label={`Discard ${draft.name || "Untitled Meetup"} draft`}
                    disabled={discardDraft.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Discard this Meetup draft?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes “{draft.name || "Untitled Meetup"}”. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep draft</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 text-white hover:bg-red-500"
                      onClick={() => discardDraft.mutate({ groupId: draft.id })}
                    >
                      Discard draft
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[1, 2].map((i) => <div key={i} className="h-44 animate-pulse bg-card/50 border border-orange-500/10 rounded-2xl" />)}
    </div>
  );
}

function MeetupGrid({ meetups, emptyMessage }: { meetups: GroupSummary[], emptyMessage: string }) {
  if (meetups.length === 0) {
    return (
      <div className="py-24 text-center bg-card/30 border border-orange-500/10 rounded-3xl backdrop-blur-md">
        <CalendarDays className="w-16 h-16 mx-auto text-orange-500/30 mb-4" />
        <p className="text-white/60 mb-6">{emptyMessage}</p>
        <Link href="/meetups"><Button variant="outline" className="rounded-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10">Find Meetups</Button></Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {meetups.map(meetup => (
        <Link key={meetup.id} href={`/meetups/${meetup.id}`}>
          <div className="group relative flex flex-col h-full bg-card border border-white/10 hover:border-orange-500/50 rounded-2xl overflow-hidden transition-all duration-300 hover-elevate shadow-md cursor-pointer">
            <div className="h-24 bg-[#171A21] relative overflow-hidden shrink-0">
              {meetup.coverUrl ? (
                <img src={meetup.coverUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="" />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-amber-500/20" />
              )}
              {meetup.viewerHasPendingRequest && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <span className="px-3 py-1 bg-background/80 rounded-full text-xs text-white/80 font-medium">Request Pending</span>
                </div>
              )}
            </div>
            <div className="p-4 pt-3 relative flex-grow flex flex-col">
              <div className="flex-grow">
                <h3 className="text-lg font-bold text-white group-hover:text-orange-400 transition-colors line-clamp-1 flex items-center gap-1.5">
                  {meetup.name}
                  {meetup.viewerMemberRole === 'owner' && <ShieldCheck className="h-4 w-4 text-orange-400" />}
                </h3>
                {meetup.location && (
                  <p className="text-xs text-white/70 mb-2 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-orange-500/70" />
                    {meetup.location}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-white/50 mt-2 pt-2 border-t border-white/5">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-orange-500/60" />
                  {meetup.memberCount} members
                </span>
                <span className="flex items-center gap-1">
                  {meetup.privacy === 'public' ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  <span className="capitalize">{meetup.privacy}</span>
                </span>
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
      onSuccess: (_result, variables) => {
        if (variables.data.action === "accept") {
          trackEvent("meetup_invite_accepted", {
            source: "meetups_dashboard",
          });
        }
        toast({ title: "Invitation updated" });
        queryClient.invalidateQueries({ queryKey: getListMyGroupInvitesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyGroupsQueryKey() });
      },
      onError: () => toast({ title: "Failed to process invitation", variant: "destructive" })
    }
  });

  if (invites.length === 0) {
    return (
      <div className="py-24 text-center bg-card/30 border border-orange-500/10 rounded-3xl backdrop-blur-md">
        <Mail className="w-12 h-12 mx-auto text-orange-500/30 mb-4" />
        <p className="text-white/60">No pending meetup invitations.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {invites.map(invite => (
        <div key={invite.id} className="flex items-center justify-between bg-card border border-orange-500/20 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center overflow-hidden">
              <CalendarDays className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <h4 className="font-bold text-white text-sm">
                {invite.group?.name || invite.groupName || `Meetup ${invite.groupId}`}
              </h4>
              <p className="text-xs text-muted-foreground">
                Invited by {invite.inviterName || invite.invitedByUserName || `user ${invite.inviterId || invite.invitedByUserId}`}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => respond.mutate({ groupId: invite.groupId, inviteId: invite.id, data: { action: 'accept' } })} className="bg-orange-600 hover:bg-orange-500 text-white h-8 px-3 rounded-full">
              <Check className="h-4 w-4 mr-1" /> Accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => respond.mutate({ groupId: invite.groupId, inviteId: invite.id, data: { action: 'decline' } })} className="h-8 px-3 rounded-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300">
              <X className="h-4 w-4 mr-1" /> Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
