import { useEffect, useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { Layout } from "@/components/Layout";
import { useGetAdminStats, useListDollApplications, useListPendingMedia, useListPendingVerifications, useReviewDollApplication, useModerateMedia, useReviewVerification, useGetDollRevenueShares, getGetAdminStatsQueryKey, getListDollApplicationsQueryKey, getListPendingMediaQueryKey, getListPendingVerificationsQueryKey, useListAdminFeedPosts, useListFeedReports, useModerateFeedPost, useReviewFeedReport, useGetFeedAnalytics, getListAdminFeedPostsQueryKey, getListFeedReportsQueryKey, getGetFeedAnalyticsQueryKey, useListAdminPhotos, useModeratePhoto, useListAdminReels, useModerateReel, useListAdminBlocks, useGetAdminProfile, useClearProfileFields, getListAdminPhotosQueryKey, getListAdminReelsQueryKey, getListAdminBlocksQueryKey, getGetAdminProfileQueryKey, useGetCurrentUser, useLogout, useAdminListShares, getAdminListSharesQueryKey, useAdminModerateShare, useAdminListSharingSuspensions, getAdminListSharingSuspensionsQueryKey, useAdminSuspendSharing, useAdminRestoreSharing, useListUsers, getListUsersQueryKey, useUpdateUserBuddyType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RevenueBreakdownItem, DollRevenueShare, AdminListSharesSourceType, AdminListSharesDestination, ListUsersParams, ListUsersBuddyType, BuddyTypeInputBuddyType } from "@workspace/api-client-react";
import { ShieldCheck, Image as ImageIcon, Users, AlertTriangle, Database, Coins, ExternalLink, Video, FileText, TrendingUp, MessageSquare, Flag, Search, Eye, CalendarDays, Share2, Lock, Unlock, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BuddyPill } from "@/components/BuddyPill";
import AdminLeads from "@/pages/AdminLeads";
import AdminCredits from "@/pages/AdminCredits";
import AdminPlans from "@/pages/AdminPlans";
import AdminEvents from "@/pages/AdminEvents";
import AdminBusinesses from "@/pages/AdminBusinesses";
import AdminGroups from "@/pages/AdminGroups";
import { AdminCustomRequests } from "@/components/admin/AdminCustomRequests";
import { ADMIN_SECTIONS, AdminSidebar, getAdminSectionFromPath, type AdminSection } from "@/components/admin/AdminSidebar";
import { Briefcase } from "lucide-react";

import { useLocation } from "wouter";

export default function AdminDashboard() {
  const { data: session, isLoading } = useGetCurrentUser();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground">
          Checking admin access...
        </div>
      </Layout>
    );
  }

  if (!session?.authenticated || session.user?.role !== "admin") {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-card/60 p-8 text-center">
            <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-primary" />
            <h1 className="mb-2 text-2xl font-serif text-white">Admin access required</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Sign in with an administrator account to open this workspace.
            </p>
            <Button asChild>
              <a href="/login">Go to login</a>
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return location === "/admin/investor-deck" ? <AdminInvestorDeck /> : <AdminDashboardContent />;
}

function AdminInvestorDeck() {
  const [, navigate] = useLocation();
  const logout = useLogout();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Investor Pitch Deck | HookahBuddys Admin";
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 lg:py-12">
        <div className="grid items-start gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
          <AdminSidebar
            activeSection="investor-deck"
            counts={{}}
            onNavigate={(section) => navigate(section.path)}
            onLogout={() => logout.mutate(undefined, {
              onSuccess: () => { window.location.href = "/"; },
            })}
          />
          <main className="min-w-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#D6B56D]">HookahBuddys Admin</p>
            <h1 className="text-3xl font-serif text-white">Investor Deck</h1>
            <p className="mt-2 text-sm text-muted-foreground">Download the HookahBuddys investor pitch deck as a PowerPoint file.</p>
            <div className="mt-8 rounded-xl border border-white/10 bg-card/50 p-6 sm:p-8">
              <h2 className="text-xl font-semibold text-white">HookahBuddys Investor Pitch Deck</h2>
              <p className="mt-2 text-sm text-muted-foreground">PowerPoint presentation (.pptx)</p>
              <Button asChild className="mt-6">
                <a href={`${import.meta.env.BASE_URL}downloads/HookahBuddys-Investor-Pitch-Deck.pptx`} download>
                  <Download className="mr-2 h-4 w-4" />
                  Download Investor Pitch Deck
                </a>
              </Button>
            </div>
          </main>
        </div>
      </div>
    </Layout>
  );
}

function AdminDashboardContent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const logout = useLogout();
  const activeSection = getAdminSectionFromPath(location);
  const activeSectionMeta = ADMIN_SECTIONS.find((section) => section.value === activeSection) ?? ADMIN_SECTIONS[0];

  const { data: stats } = useGetAdminStats();
  const { data: dollRevenue } = useGetDollRevenueShares();
  const { data: applications } = useListDollApplications();
  const { data: pendingMedia } = useListPendingMedia();
  const { data: verifications } = useListPendingVerifications();

  const navigateToSection = (section: AdminSection) => {
    navigate(section.path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/";
      },
    });
  };

  const reviewApp = useReviewDollApplication();
  const moderateMedia = useModerateMedia();
  const reviewVerif = useReviewVerification();

  const handleReviewApp = (id: number, decision: 'approve' | 'reject') => {
    reviewApp.mutate({ id, data: { decision } }, {
      onSuccess: () => {
        toast({ title: "Application updated" });
        queryClient.invalidateQueries({ queryKey: getListDollApplicationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
      }
    });
  };

  const handleModerateMedia = (id: number, decision: 'approve' | 'reject') => {
    moderateMedia.mutate({ id, data: { decision } }, {
      onSuccess: () => {
        toast({ title: "Media moderated" });
        queryClient.invalidateQueries({ queryKey: getListPendingMediaQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
      }
    });
  };

  const handleReviewVerif = (id: number, decision: 'approve' | 'reject') => {
    reviewVerif.mutate({ id, data: { decision } }, {
      onSuccess: () => {
        toast({ title: "Verification updated" });
        queryClient.invalidateQueries({ queryKey: getListPendingVerificationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminStatsQueryKey() });
      }
    });
  };

  const { data: feedReports } = useListFeedReports({ status: "pending" });
  const { data: feedAnalytics } = useGetFeedAnalytics();
  const { data: allPosts } = useListAdminFeedPosts({});

  const moderateFeed = useModerateFeedPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post moderated" });
        queryClient.invalidateQueries({ queryKey: getListAdminFeedPostsQueryKey({}) });
        queryClient.invalidateQueries({ queryKey: getGetFeedAnalyticsQueryKey() });
      }
    }
  });

  const reviewReport = useReviewFeedReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Report reviewed" });
        queryClient.invalidateQueries({ queryKey: getListFeedReportsQueryKey({ status: "pending" }) });
      }
    }
  });

  const [shareStatusFilter, setShareStatusFilter] = useState<"active" | "hidden" | "removed">("active");
  const [shareSourceTypeFilter, setShareSourceTypeFilter] = useState<AdminListSharesSourceType | undefined>(undefined);
  const [shareDestinationFilter, setShareDestinationFilter] = useState<AdminListSharesDestination | undefined>(undefined);

  const sharesParams = {
    status: shareStatusFilter,
    sourceType: shareSourceTypeFilter,
    destination: shareDestinationFilter,
  };

  const { data: sharesList } = useAdminListShares(sharesParams, {
    query: { queryKey: getAdminListSharesQueryKey(sharesParams) },
  });

  const moderateShare = useAdminModerateShare({
    mutation: {
      onSuccess: () => {
        toast({ title: "Share moderated" });
        queryClient.invalidateQueries({ queryKey: getAdminListSharesQueryKey(sharesParams) });
      },
      onError: () => toast({ title: "Failed to moderate share", variant: "destructive" }),
    }
  });

  const { data: suspensionsList } = useAdminListSharingSuspensions(undefined, { query: { queryKey: getAdminListSharingSuspensionsQueryKey() } });
  const suspendSharing = useAdminSuspendSharing({
    mutation: {
      onSuccess: () => {
        toast({ title: "Sharing suspended" });
        queryClient.invalidateQueries({ queryKey: getAdminListSharingSuspensionsQueryKey() });
      },
      onError: () => toast({ title: "Failed to suspend sharing", variant: "destructive" }),
    }
  });
  const restoreSharing = useAdminRestoreSharing({
    mutation: {
      onSuccess: () => {
        toast({ title: "Sharing restored" });
        queryClient.invalidateQueries({ queryKey: getAdminListSharingSuspensionsQueryKey() });
      },
      onError: () => toast({ title: "Failed to restore sharing", variant: "destructive" }),
    }
  });

  const [suspendUserId, setSuspendUserId] = useState("");
  const [suspendReason, setSuspendReason] = useState("");

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 lg:py-12">
        <div className="grid items-start gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
          <AdminSidebar
            activeSection={activeSection}
            counts={{
              applications: applications?.length ?? 0,
              media: pendingMedia?.length ?? 0,
              verifications: verifications?.length ?? 0,
            }}
            onNavigate={navigateToSection}
            onLogout={handleLogout}
          />

          <div className="min-w-0">
            <div className="mb-8">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#D6B56D]">HookahBuddys Admin</p>
              <h1 className="text-3xl font-serif text-white">{activeSectionMeta.label}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{activeSectionMeta.description}</p>
            </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2">Total Revenue</h3>
            <p className="text-3xl font-bold text-primary">{currency(stats?.totalRevenue ?? 0)}</p>
          </div>
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2">Total Buddys</h3>
            <p className="text-3xl font-bold text-white">{stats?.totalDolls || 0}</p>
          </div>
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2">Pending Apps</h3>
            <p className="text-3xl font-bold text-white">{stats?.pendingApplications || 0}</p>
          </div>
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2">Pending Media</h3>
            <p className="text-3xl font-bold text-white">{stats?.pendingMedia || 0}</p>
          </div>
        </div>

        <RevenueBreakdown
          breakdown={stats?.revenueBreakdown}
          total={stats?.totalRevenue ?? 0}
          monthly={stats?.monthlyRevenue ?? 0}
        />

        <DollRevenueShares dolls={dollRevenue} />

        <Tabs value={activeSection} onValueChange={(value) => {
          const section = ADMIN_SECTIONS.find((item) => item.value === value);
          if (section) navigateToSection(section);
        }} className="w-full">

          <TabsContent value="applications" className="space-y-4">
            <h2 className="text-xl font-serif text-white mb-4">Pending Buddy Applications</h2>
            {applications?.map(app => (
              <div key={app.id} className="bg-card/50 border border-white/10 rounded-xl p-6">
                <div className="flex justify-between items-start gap-4 mb-4">
                  <div>
                    <p className="font-bold text-white">{app.stageName}</p>
                    {app.legalName && (
                      <p className="text-sm text-muted-foreground">Legal name: {app.legalName}</p>
                    )}
                    <p className="text-sm text-muted-foreground">{app.email} &bull; {app.city}, {app.state}</p>
                    {(app.favoriteFlavor || app.experienceLevel) && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {[app.experienceLevel, app.favoriteFlavor].filter(Boolean).join(" \u2022 ")}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button onClick={() => handleReviewApp(app.id, 'approve')} className="bg-green-600 hover:bg-green-700 text-white">Approve</Button>
                    <Button onClick={() => handleReviewApp(app.id, 'reject')} variant="destructive">Reject</Button>
                  </div>
                </div>

                {app.bio && <p className="text-sm text-white/80 mb-4">{app.bio}</p>}

                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Submitted documents</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <DocTile label="Government ID" url={app.governmentIdUrl} />
                  <DocTile label="Verification Selfie" url={app.verificationPhotoUrl} />
                  <DocTile label="Profile Photo" url={app.profilePhotoUrl} />
                  <DocTile label="Verification Video" url={app.verificationVideoUrl} kind="video" />
                </div>
              </div>
            ))}
            {(!applications || applications.length === 0) && <p className="text-muted-foreground">No pending applications.</p>}
          </TabsContent>

          <TabsContent value="media" className="space-y-4">
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 mb-4">
              <h3 className="text-destructive font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4"/> Hookah Rule Enforcement</h3>
              <p className="text-sm text-destructive-foreground">You MUST reject any media that does not clearly feature a visible hookah. This is a strict platform requirement.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {pendingMedia?.map(media => (
                <div key={media.id} className="bg-card/50 border border-white/10 rounded-xl overflow-hidden">
                  <div className="aspect-square bg-black/50 relative">
                    <img src={media.url} alt="Pending media" className="object-contain w-full h-full" />
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-white mb-2">Buddy: {media.dollName || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground mb-4">Type: {media.type}</p>
                    <div className="flex gap-2">
                      <Button onClick={() => handleModerateMedia(media.id, 'approve')} className="w-full bg-green-600 hover:bg-green-700 text-white">Approve</Button>
                      <Button onClick={() => handleModerateMedia(media.id, 'reject')} variant="destructive" className="w-full">Reject</Button>
                    </div>
                  </div>
                </div>
              ))}
              {(!pendingMedia || pendingMedia.length === 0) && <p className="col-span-full text-muted-foreground">No pending media.</p>}
            </div>
          </TabsContent>

          <TabsContent value="verifications" className="space-y-4">
            <h2 className="text-xl font-serif text-white mb-4">Pending Verifications</h2>
            {verifications?.map(verif => (
              <div key={verif.id} className="bg-card/50 border border-white/10 rounded-xl p-6">
                <p className="font-bold text-white mb-4">Buddy ID: {verif.dollId} - {verif.dollName}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">ID</p>
                    <img src={verif.governmentIdUrl} className="w-full h-24 object-cover rounded bg-black/50" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Selfie</p>
                    <img src={verif.selfieUrl} className="w-full h-24 object-cover rounded bg-black/50" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Hookah Photo</p>
                    <img src={verif.hookahPhotoUrl} className="w-full h-24 object-cover rounded bg-black/50" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => handleReviewVerif(verif.id, 'approve')} className="bg-green-600 hover:bg-green-700 text-white">Approve Verification</Button>
                  <Button onClick={() => handleReviewVerif(verif.id, 'reject')} variant="destructive">Reject Verification</Button>
                </div>
              </div>
            ))}
            {(!verifications || verifications.length === 0) && <p className="text-muted-foreground">No pending verifications.</p>}
          </TabsContent>

          <TabsContent value="feed" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-card/50 border border-white/10 rounded-xl p-5">
                <h3 className="text-sm text-muted-foreground mb-1">Total Posts</h3>
                <p className="text-2xl font-bold text-white">{feedAnalytics?.totalPosts || 0}</p>
              </div>
              <div className="bg-card/50 border border-white/10 rounded-xl p-5">
                <h3 className="text-sm text-muted-foreground mb-1">Total Comments</h3>
                <p className="text-2xl font-bold text-white">{feedAnalytics?.totalComments || 0}</p>
              </div>
              <div className="bg-card/50 border border-white/10 rounded-xl p-5">
                <h3 className="text-sm text-muted-foreground mb-1">Active Members</h3>
                <p className="text-2xl font-bold text-white">{feedAnalytics?.activeUsers || 0}</p>
              </div>
              <div className="bg-card/50 border border-white/10 rounded-xl p-5">
                <h3 className="text-sm text-muted-foreground mb-1">Pending Reports</h3>
                <p className="text-2xl font-bold text-destructive">{feedReports?.length || 0}</p>
              </div>
            </div>

            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-5">
              <h2 className="text-xl font-serif text-white mb-4 flex items-center gap-2">
                <Flag className="w-5 h-5 text-destructive" /> Reported Content
              </h2>
              {feedReports?.length === 0 ? (
                <p className="text-muted-foreground text-sm">No pending reports.</p>
              ) : (
                <div className="space-y-4">
                  {feedReports?.map(report => (
                    <div key={report.id} className="bg-card/80 border border-white/10 rounded-lg p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="text-sm font-bold text-destructive uppercase tracking-wider">{report.targetType}</p>
                          <p className="text-white mt-1">Reason: <span className="font-semibold text-primary">{report.reason}</span></p>
                          <p className="text-xs text-muted-foreground mt-1">Reported by User ID: {report.reporterId}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => reviewReport.mutate({ id: report.id, data: { status: "dismissed" } })} variant="outline" className="border-white/20 text-white">Dismiss Report</Button>
                          <Button size="sm" onClick={() => reviewReport.mutate({ id: report.id, data: { status: "action_taken" } })} variant="destructive">Mark Action Taken</Button>
                        </div>
                      </div>
                      <div className="bg-background/50 rounded p-3 text-sm text-white/80 whitespace-pre-wrap border border-white/5">
                        <span className="text-xs text-muted-foreground block mb-1">Content Snippet:</span>
                        {report.targetType === "post" ? report.postText : report.commentText}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-card/50 border border-white/10 rounded-xl p-6">
              <h2 className="text-xl font-serif text-white mb-4">All Lounge Posts</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-white/10">
                      <th className="py-3 px-2 font-medium">ID</th>
                      <th className="py-3 px-2 font-medium">Author</th>
                      <th className="py-3 px-2 font-medium">Content</th>
                      <th className="py-3 px-2 font-medium">Status</th>
                      <th className="py-3 px-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allPosts?.map(post => (
                      <tr key={post.id} className="border-b border-white/5">
                        <td className="py-3 px-2 text-white/60">{post.id}</td>
                        <td className="py-3 px-2 text-white">{post.userName}</td>
                        <td className="py-3 px-2 text-white/80 max-w-[300px] truncate">{post.text}</td>
                        <td className="py-3 px-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold ${post.status === 'active' ? 'bg-green-500/20 text-green-400' : post.status === 'removed' ? 'bg-destructive/20 text-destructive' : 'bg-secondary/20 text-secondary'}`}>
                            {post.status}
                          </span>
                        </td>
                        <td className="py-3 px-2">
                          <div className="flex gap-1">
                            {post.status !== "active" && <Button size="sm" variant="ghost" onClick={() => moderateFeed.mutate({ id: post.id, data: { status: "active" } })} className="h-7 text-xs text-green-400 hover:bg-green-400/10">Approve</Button>}
                            {post.status !== "hidden" && <Button size="sm" variant="ghost" onClick={() => moderateFeed.mutate({ id: post.id, data: { status: "hidden" } })} className="h-7 text-xs text-secondary hover:bg-secondary/10">Hide</Button>}
                            {post.status !== "removed" && <Button size="sm" variant="ghost" onClick={() => moderateFeed.mutate({ id: post.id, data: { status: "removed" } })} className="h-7 text-xs text-destructive hover:bg-destructive/10">Remove</Button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="shares" className="space-y-6">
            <h2 className="text-xl font-serif text-white mb-4">Sharing Moderation</h2>

            <div className="bg-card/50 border border-white/10 rounded-xl p-6 mb-6">
              <h3 className="font-serif text-lg text-white mb-4">Sharing Suspensions</h3>
              <div className="flex gap-4 mb-6">
                <div className="flex-1">
                  <Input
                    placeholder="User ID to suspend"
                    value={suspendUserId}
                    onChange={e => setSuspendUserId(e.target.value)}
                    className="bg-background/50 border-white/10"
                  />
                </div>
                <div className="flex-[2]">
                  <Input
                    placeholder="Reason"
                    value={suspendReason}
                    onChange={e => setSuspendReason(e.target.value)}
                    className="bg-background/50 border-white/10"
                  />
                </div>
                <Button
                  onClick={() => suspendUserId && suspendReason && suspendSharing.mutate({ userId: parseInt(suspendUserId, 10), data: { reason: suspendReason } })}
                  disabled={!suspendUserId || !suspendReason || suspendSharing.isPending}
                  variant="destructive"
                >
                  <Lock className="w-4 h-4 mr-2" /> Suspend
                </Button>
              </div>

              {suspensionsList && suspensionsList.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-white/10">
                        <th className="py-2 px-2 font-medium">User ID</th>
                        <th className="py-2 px-2 font-medium">Status</th>
                        <th className="py-2 px-2 font-medium">Reason</th>
                        <th className="py-2 px-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suspensionsList.map(sus => (
                        <tr key={sus.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="py-3 px-2 text-white">{sus.userId}</td>
                          <td className="py-3 px-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${sus.status === 'active' ? 'bg-destructive/20 text-destructive' : 'bg-white/10 text-white/50'}`}>
                              {sus.status}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-white/80">{sus.reason}</td>
                          <td className="py-3 px-2">
                            {sus.status === 'active' && (
                              <Button size="sm" variant="outline" onClick={() => restoreSharing.mutate({ userId: sus.userId })} className="h-8">
                                <Unlock className="w-3 h-3 mr-1" /> Restore
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No active sharing suspensions.</p>
              )}
            </div>

            <div className="bg-card/50 border border-white/10 rounded-xl p-6">
              <div className="mb-6 space-y-4">
                <h3 className="font-serif text-lg text-white">Share Records</h3>

                {/* Status filter */}
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider mr-1">Status:</span>
                  <Button size="sm" variant={shareStatusFilter === "active" ? "default" : "outline"} onClick={() => setShareStatusFilter("active")}>Active</Button>
                  <Button size="sm" variant={shareStatusFilter === "hidden" ? "default" : "outline"} onClick={() => setShareStatusFilter("hidden")}>Hidden</Button>
                  <Button size="sm" variant={shareStatusFilter === "removed" ? "default" : "outline"} onClick={() => setShareStatusFilter("removed")}>Removed</Button>
                </div>

                {/* Source type filter */}
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider mr-1">Source:</span>
                  <Button size="sm" variant={!shareSourceTypeFilter ? "default" : "outline"} onClick={() => setShareSourceTypeFilter(undefined)}>All</Button>
                  <Button size="sm" variant={shareSourceTypeFilter === "feed_post" ? "default" : "outline"} onClick={() => setShareSourceTypeFilter("feed_post")}>Lounge Post</Button>
                  <Button size="sm" variant={shareSourceTypeFilter === "group_post" ? "default" : "outline"} onClick={() => setShareSourceTypeFilter("group_post")}>Group Post</Button>
                </div>

                {/* Destination filter */}
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider mr-1">Destination:</span>
                  <Button size="sm" variant={!shareDestinationFilter ? "default" : "outline"} onClick={() => setShareDestinationFilter(undefined)}>All</Button>
                  {(["public", "lounge", "friends", "private", "group"] as const).map(dest => (
                    <Button
                      key={dest}
                      size="sm"
                      variant={shareDestinationFilter === dest ? "default" : "outline"}
                      onClick={() => setShareDestinationFilter(dest)}
                      className="capitalize"
                    >
                      {dest}
                    </Button>
                  ))}
                </div>
              </div>

              {sharesList?.shares && sharesList.shares.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-white/10">
                        <th className="py-2 px-2 font-medium">Share ID</th>
                        <th className="py-2 px-2 font-medium">Sharer</th>
                        <th className="py-2 px-2 font-medium">Destination</th>
                        <th className="py-2 px-2 font-medium">Source</th>
                        <th className="py-2 px-2 font-medium">Status</th>
                        <th className="py-2 px-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sharesList.shares.map(share => (
                        <tr key={share.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="py-3 px-2 text-white/70">#{share.id}</td>
                          <td className="py-3 px-2 text-white">{share.sharerName || share.sharerId}</td>
                          <td className="py-3 px-2 text-white/90 capitalize">{share.destination}</td>
                          <td className="py-3 px-2 text-white/90 capitalize">
                            {share.sourceType} #{share.sourcePostId}
                          </td>
                          <td className="py-3 px-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                              share.status === 'active' ? 'bg-green-500/20 text-green-500' :
                              share.status === 'hidden' ? 'bg-orange-500/20 text-orange-500' :
                              'bg-destructive/20 text-destructive'
                            }`}>
                              {share.status}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex gap-2">
                              {share.status !== 'hidden' && (
                                <Button size="sm" variant="outline" onClick={() => moderateShare.mutate({ shareId: share.id, data: { action: 'hide' } })} disabled={moderateShare.isPending} className="h-7 text-xs px-2 text-orange-500">Hide</Button>
                              )}
                              {share.status !== 'removed' && (
                                <Button size="sm" variant="outline" onClick={() => moderateShare.mutate({ shareId: share.id, data: { action: 'remove' } })} disabled={moderateShare.isPending} className="h-7 text-xs px-2 text-destructive">Remove</Button>
                              )}
                              {share.status !== 'active' && (
                                <Button size="sm" variant="outline" onClick={() => moderateShare.mutate({ shareId: share.id, data: { action: 'restore' } })} disabled={moderateShare.isPending} className="h-7 text-xs px-2 text-green-500">Restore</Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center border border-white/5 rounded-lg">No shares found for this filter.</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="photos">
            <PhotoModeration />
          </TabsContent>

          <TabsContent value="reels">
            <ReelModeration />
          </TabsContent>

          <TabsContent value="blocks">
            <BlocksList />
          </TabsContent>

          <TabsContent value="users">
            <AdminUsers />
          </TabsContent>

          <TabsContent value="profiles">
            <ProfileInspector />
          </TabsContent>

          <TabsContent value="credits">
            <AdminCredits />
          </TabsContent>

          <TabsContent value="plans">
            <AdminPlans />
          </TabsContent>

          <TabsContent value="events">
            <AdminEvents />
          </TabsContent>

          <TabsContent value="leads">
            <AdminLeads />
          </TabsContent>

          <TabsContent value="businesses">
            <AdminBusinesses />
          </TabsContent>

          <TabsContent value="groups">
            <AdminGroups />
          </TabsContent>

          <TabsContent value="custom-requests">
            <AdminCustomRequests />
          </TabsContent>
        </Tabs>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function PhotoModeration() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | undefined>();

  const { data: photos } = useListAdminPhotos({ status: statusFilter }, {
    query: { queryKey: getListAdminPhotosQueryKey({ status: statusFilter }) },
  });

  const moderatePhoto = useModeratePhoto({
    mutation: {
      onSuccess: () => {
        toast({ title: "Photo moderated" });
        queryClient.invalidateQueries({ queryKey: getListAdminPhotosQueryKey({}) });
      },
      onError: () => toast({ title: "Failed to moderate", variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Button
          variant={!statusFilter ? "default" : "outline"}
          onClick={() => setStatusFilter(undefined)}
          size="sm"
        >
          All
        </Button>
        <Button
          variant={statusFilter === "pending" ? "default" : "outline"}
          onClick={() => setStatusFilter("pending")}
          size="sm"
        >
          Pending
        </Button>
        <Button
          variant={statusFilter === "approved" ? "default" : "outline"}
          onClick={() => setStatusFilter("approved")}
          size="sm"
        >
          Approved
        </Button>
        <Button
          variant={statusFilter === "rejected" ? "default" : "outline"}
          onClick={() => setStatusFilter("rejected")}
          size="sm"
        >
          Rejected
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {!photos || photos.length === 0 ? (
          <p className="col-span-full text-muted-foreground">No photos.</p>
        ) : (
          photos.map((photo) => (
            <div key={photo.id} className="bg-card/50 border border-white/10 rounded-xl overflow-hidden">
              <div className="aspect-square bg-black/50 relative">
                <img src={photo.imageUrl} alt="Photo" className="object-cover w-full h-full" />
              </div>
              <div className="p-4">
                <p className="text-sm text-white mb-2">By: {photo.userName}</p>
                <p className="text-xs text-muted-foreground mb-4">
                  Status: <span className="capitalize">{photo.status}</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => moderatePhoto.mutate({ id: photo.id, data: { status: "active" } })}
                    disabled={moderatePhoto.isPending}
                    size="sm"
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  >
                    Approve
                  </Button>
                  <Button
                    onClick={() => moderatePhoto.mutate({ id: photo.id, data: { status: "removed" } })}
                    disabled={moderatePhoto.isPending}
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ReelModeration() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | undefined>();

  const { data: reels } = useListAdminReels({ status: statusFilter }, {
    query: { queryKey: getListAdminReelsQueryKey({ status: statusFilter }) },
  });

  const moderateReel = useModerateReel({
    mutation: {
      onSuccess: () => {
        toast({ title: "Spark moderated" });
        queryClient.invalidateQueries({ queryKey: getListAdminReelsQueryKey({}) });
      },
      onError: () => toast({ title: "Failed to moderate", variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Button
          variant={!statusFilter ? "default" : "outline"}
          onClick={() => setStatusFilter(undefined)}
          size="sm"
        >
          All
        </Button>
        <Button
          variant={statusFilter === "pending" ? "default" : "outline"}
          onClick={() => setStatusFilter("pending")}
          size="sm"
        >
          Pending
        </Button>
        <Button
          variant={statusFilter === "approved" ? "default" : "outline"}
          onClick={() => setStatusFilter("approved")}
          size="sm"
        >
          Approved
        </Button>
        <Button
          variant={statusFilter === "rejected" ? "default" : "outline"}
          onClick={() => setStatusFilter("rejected")}
          size="sm"
        >
          Rejected
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {!reels || reels.length === 0 ? (
          <p className="col-span-full text-muted-foreground">No Sparks.</p>
        ) : (
          reels.map((reel) => (
            <div key={reel.id} className="bg-card/50 border border-white/10 rounded-xl overflow-hidden">
              <div className="aspect-[9/16] bg-black/50 relative">
                {reel.thumbnailUrl ? (
                  <img src={reel.thumbnailUrl} alt="Spark" className="object-cover w-full h-full" />
                ) : (
                  <div className="flex items-center justify-center w-full h-full">
                    <Video className="w-12 h-12 text-muted-foreground/30" />
                  </div>
                )}
              </div>
              <div className="p-4">
                <p className="text-sm text-white mb-2">By: {reel.userName}</p>
                <p className="text-xs text-muted-foreground mb-4">
                  Status: <span className="capitalize">{reel.status}</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => moderateReel.mutate({ id: reel.id, data: { status: "active" } })}
                    disabled={moderateReel.isPending}
                    size="sm"
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  >
                    Approve
                  </Button>
                  <Button
                    onClick={() => moderateReel.mutate({ id: reel.id, data: { status: "removed" } })}
                    disabled={moderateReel.isPending}
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function BlocksList() {
  const { data: blocks } = useListAdminBlocks({
    query: { queryKey: getListAdminBlocksQueryKey() },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-serif text-white mb-4">User Blocks</h2>
      {!blocks || blocks.length === 0 ? (
        <p className="text-muted-foreground">No blocks recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-white/10">
                <th className="py-3 px-2 font-medium">Blocker ID</th>
                <th className="py-3 px-2 font-medium">Blocked ID</th>
                <th className="py-3 px-2 font-medium">Blocker Name</th>
                <th className="py-3 px-2 font-medium">Blocked Name</th>
                <th className="py-3 px-2 font-medium">Created At</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((block) => (
                <tr key={`${block.blockerId}-${block.blockedUserId}`} className="border-b border-white/5">
                  <td className="py-3 px-2 text-white/60">{block.blockerId}</td>
                  <td className="py-3 px-2 text-white/60">{block.blockedUserId}</td>
                  <td className="py-3 px-2 text-white">{block.blockerName || "N/A"}</td>
                  <td className="py-3 px-2 text-white">{block.blockedUserName || "N/A"}</td>
                  <td className="py-3 px-2 text-white/60">
                    {block.createdAt ? new Date(block.createdAt).toLocaleDateString() : "N/A"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProfileInspector() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [userId, setUserId] = useState("");
  const [searchedUserId, setSearchedUserId] = useState<number | null>(null);

  const { data: profile } = useGetAdminProfile(searchedUserId || 0, {
    query: {
      enabled: !!searchedUserId,
      queryKey: getGetAdminProfileQueryKey(searchedUserId || 0),
    },
  });

  const clearFields = useClearProfileFields({
    mutation: {
      onSuccess: () => {
        toast({ title: "Profile fields cleared" });
        if (searchedUserId) {
          queryClient.invalidateQueries({ queryKey: getGetAdminProfileQueryKey(searchedUserId) });
        }
      },
      onError: () => toast({ title: "Failed to clear fields", variant: "destructive" }),
    },
  });

  const [selectedFields, setSelectedFields] = useState<string[]>([]);

  const handleSearch = () => {
    const id = parseInt(userId, 10);
    if (!isNaN(id)) {
      setSearchedUserId(id);
    }
  };

  const handleClearFields = () => {
    if (!searchedUserId) return;
    clearFields.mutate({ userId: searchedUserId, data: { clearFields: selectedFields } });
    setSelectedFields([]);
  };

  const allFields = [
    "description",
    "coverPhotoUrl",
    "livesInCity",
    "livesInState",
    "fromCity",
    "fromState",
    "birthMonth",
    "birthDay",
    "gender",
    "languagesSpoken",
    "hairColor",
    "eyeColor",
    "bodyType",
    "height",
    "favoriteHookahFlavor",
    "favoriteHookahLounge",
    "favoriteHookahBrand",
    "hookahExperienceLevel",
    "preferredHookahStyle",
    "favoriteSmokeSessionVibe",
    "favoriteHookahAccessories",
    "openToLoungeMeetups",
    "favoriteLoungeCity",
    "interests",
    "socialLinks",
  ];

  return (
    <div className="space-y-6">
      <div className="bg-card/50 border border-white/10 rounded-xl p-6">
        <h2 className="text-xl font-serif text-white mb-4">Profile Inspector</h2>
        <div className="flex gap-3">
          <div className="flex-1">
            <Label htmlFor="userId">User ID</Label>
            <Input
              id="userId"
              type="number"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Enter user ID"
              className="bg-background/50 border-white/10 mt-2"
            />
          </div>
          <Button
            onClick={handleSearch}
            className="self-end bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Search className="w-4 h-4 mr-2" /> Search
          </Button>
        </div>
      </div>

      {profile && (
        <div className="bg-card/50 border border-white/10 rounded-xl p-6 space-y-6">
          <div>
            <h3 className="text-lg font-serif text-white mb-3">Profile Data</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="text-white">{profile.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Username</p>
                <p className="text-white">{profile.username || "N/A"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">User ID</p>
                <p className="text-white">{profile.userId}</p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-serif text-white mb-3">Clear Profile Fields</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Select fields to clear from this profile:
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              {allFields.map((field) => (
                <label
                  key={field}
                  className="flex items-center gap-2 text-sm text-white cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedFields.includes(field)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFields([...selectedFields, field]);
                      } else {
                        setSelectedFields(selectedFields.filter((f) => f !== field));
                      }
                    }}
                    className="w-4 h-4 rounded border-white/20 bg-background/50 text-primary"
                  />
                  <span className="capitalize">{field.replace(/([A-Z])/g, " $1").trim()}</span>
                </label>
              ))}
            </div>
            <Button
              onClick={handleClearFields}
              disabled={clearFields.isPending || selectedFields.length === 0}
              variant="destructive"
              className="w-full"
            >
              {clearFields.isPending ? "Clearing..." : `Clear ${selectedFields.length} field(s)`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function currency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function RevenueBreakdown({
  breakdown,
  total,
  monthly,
}: {
  breakdown?: RevenueBreakdownItem[];
  total: number;
  monthly: number;
}) {
  const items = breakdown ?? [];

  return (
    <div className="bg-card/50 border border-white/10 rounded-xl p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-serif text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" /> Total Revenue Breakdown
        </h2>
        <p className="text-sm text-muted-foreground">
          Est. monthly: <span className="text-white font-medium">{currency(monthly)}</span>
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground">No revenue data available.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-white/10">
                <th className="py-3 font-medium">Source</th>
                <th className="py-3 font-medium text-right">Subscribers</th>
                <th className="py-3 font-medium text-right">Price / mo</th>
                <th className="py-3 font-medium text-right">Subtotal</th>
                <th className="py-3 font-medium text-right">% of total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.label} className="border-b border-white/5">
                  <td className="py-3 text-white">{item.label}</td>
                  <td className="py-3 text-right text-white/80">{item.count.toLocaleString("en-US")}</td>
                  <td className="py-3 text-right text-white/80">{currency(item.unitPrice)}</td>
                  <td className="py-3 text-right text-white font-medium">{currency(item.amount)}</td>
                  <td className="py-3 text-right text-muted-foreground">
                    {total > 0 ? `${Math.round((item.amount / total) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10">
                <td className="py-3 text-white font-bold">Total</td>
                <td className="py-3" />
                <td className="py-3" />
                <td className="py-3 text-right text-primary font-bold">{currency(total)}</td>
                <td className="py-3 text-right text-muted-foreground">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function DollRevenueShares({ dolls }: { dolls?: DollRevenueShare[] }) {
  const items = dolls ?? [];
  const total = items.reduce((sum, d) => sum + d.revenue, 0);
  const topShare = items.length > 0 ? Math.max(...items.map((d) => d.share)) : 0;

  return (
    <div className="bg-card/50 border border-white/10 rounded-xl p-6 mb-8">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-serif text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />  Revenue Share by Buddy
        </h2>
        <p className="text-sm text-muted-foreground">
          Across {items.length} {items.length === 1 ? "Buddy" : "Buddys"} ·{" "}
          <span className="text-white font-medium">{currency(total)}</span>
        </p>
      </div>
      <p className="text-xs text-muted-foreground mb-6">

        Estimated gross earnings attributed to each Buddy (creator revenue) — measured separately
        from the platform subscription revenue above.
      </p>

      {items.length === 0 ? (
        <p className="text-muted-foreground">No Buddy revenue to show yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map((d, i) => (
            <div key={d.dollId} className="flex items-center gap-4">
              <span className="w-6 text-sm text-muted-foreground tabular-nums shrink-0">{i + 1}</span>
              {d.profilePhotoUrl ? (
                <img
                  src={d.profilePhotoUrl}
                  alt={d.stageName}
                  className="w-10 h-10 rounded-full object-cover bg-black/40 shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-white font-medium truncate flex items-center gap-1.5">
                    {d.stageName}
                    {d.verified && <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </p>
                  <p className="text-sm text-white/80 shrink-0 tabular-nums">
                    {currency(d.revenue)} <span className="text-muted-foreground">· {d.share}%</span>
                  </p>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${topShare > 0 ? (d.share / topShare) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocTile({
  label,
  url,
  kind = "image",
}: {
  label: string;
  url?: string;
  kind?: "image" | "video";
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="group block relative w-full h-28 rounded bg-black/50 border border-white/10 overflow-hidden"
          title={`Open ${label} in a new tab`}
        >
          {kind === "video" ? (
            <video src={url} className="w-full h-full object-cover" muted preload="metadata" />
          ) : (
            <img src={url} alt={label} className="w-full h-full object-cover" />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/50 transition-colors">
            <span className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 text-xs text-white">
              {kind === "video" ? <Video className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
              Open
            </span>
          </span>
        </a>
      ) : (
        <div className="w-full h-28 rounded bg-black/30 border border-dashed border-white/10 flex flex-col items-center justify-center text-muted-foreground">
          <FileText className="w-4 h-4 mb-1" />
          <span className="text-xs">Not provided</span>
        </div>
      )}
    </div>
  );
}

function AdminUsers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [buddyTypeFilter, setBuddyTypeFilter] = useState<ListUsersBuddyType | "all">("all");

  const params: ListUsersParams = buddyTypeFilter !== "all"
    ? { buddyType: buddyTypeFilter }
    : {};

  const { data: users, isLoading } = useListUsers(params, {
    query: { queryKey: getListUsersQueryKey(params) },
  });

  const updateBuddyType = useUpdateUserBuddyType({
    mutation: {
      onSuccess: () => {
        toast({ title: "Buddy Type updated" });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => toast({ title: "Update failed", variant: "destructive" })
    }
  });

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-serif text-white mb-4">Users Administration</h2>

      <div className="flex gap-4 items-center">
        <Label>Filter by Buddy Type:</Label>
        <Select value={buddyTypeFilter} onValueChange={(v) => setBuddyTypeFilter(v as ListUsersBuddyType | "all")}>
          <SelectTrigger className="w-[180px] bg-background/50 border-white/10">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="female_buddy">Female Buddy</SelectItem>
            <SelectItem value="male_buddy">Male Buddy</SelectItem>
            <SelectItem value="missing">Missing Buddy Type</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card/50 border border-white/10 rounded-xl p-6">
        {isLoading ? (
          <div className="text-muted-foreground text-sm">Loading users...</div>
        ) : !users?.length ? (
          <div className="text-muted-foreground text-sm">No users found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-white/10">
                  <th className="py-2 px-2 font-medium">ID</th>
                  <th className="py-2 px-2 font-medium">Name</th>
                  <th className="py-2 px-2 font-medium">Email</th>
                  <th className="py-2 px-2 font-medium">Role</th>
                  <th className="py-2 px-2 font-medium">Buddy Type</th>
                  <th className="py-2 px-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => {
                  const isPersonalAccount = user.role === "member" || user.role === "doll";
                  return (
                  <tr key={user.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-3 px-2 text-white">{user.id}</td>
                    <td className="py-3 px-2 text-white">{user.name}</td>
                    <td className="py-3 px-2 text-white/80">{user.email}</td>
                    <td className="py-3 px-2 capitalize">{user.role}</td>
                    <td className="py-3 px-2">
                      {isPersonalAccount && user.buddyType ? (
                        <BuddyPill buddyType={user.buddyType} />
                      ) : isPersonalAccount ? (
                        <span className="text-destructive font-semibold">Missing</span>
                      ) : (
                        <span className="text-muted-foreground">Not applicable</span>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      <Select
                         value={user.buddyType || ""}
                         onValueChange={(v) => updateBuddyType.mutate({
                           id: user.id,
                           data: { buddyType: v as BuddyTypeInputBuddyType },
                         })}
                         disabled={!isPersonalAccount || updateBuddyType.isPending}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs bg-background/50 border-white/10">
                          <SelectValue placeholder="Set Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="female_buddy">Female Buddy</SelectItem>
                          <SelectItem value="male_buddy">Male Buddy</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
