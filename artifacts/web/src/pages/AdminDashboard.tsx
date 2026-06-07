import { Layout } from "@/components/Layout";
import { useGetAdminStats, useListDollApplications, useListPendingMedia, useListPendingVerifications, useReviewDollApplication, useModerateMedia, useReviewVerification, getGetAdminStatsQueryKey, getListDollApplicationsQueryKey, getListPendingMediaQueryKey, getListPendingVerificationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldCheck, Image as ImageIcon, Users, AlertTriangle, Database, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AdminLeads from "@/pages/AdminLeads";
import AdminCredits from "@/pages/AdminCredits";

export default function AdminDashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: stats } = useGetAdminStats();
  const { data: applications } = useListDollApplications();
  const { data: pendingMedia } = useListPendingMedia();
  const { data: verifications } = useListPendingVerifications();

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

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-3xl font-serif text-white mb-8">Admin Dashboard</h1>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2">Total Revenue</h3>
            <p className="text-3xl font-bold text-primary">${stats?.totalRevenue || 0}</p>
          </div>
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2">Total Dolls</h3>
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

        <Tabs defaultValue="applications" className="w-full">
          <TabsList className="bg-card border border-white/10 mb-6">
            <TabsTrigger value="applications"><Users className="w-4 h-4 mr-2"/> Applications</TabsTrigger>
            <TabsTrigger value="media"><ImageIcon className="w-4 h-4 mr-2"/> Media Moderation</TabsTrigger>
            <TabsTrigger value="verifications"><ShieldCheck className="w-4 h-4 mr-2"/> Verifications</TabsTrigger>
            <TabsTrigger value="credits"><Coins className="w-4 h-4 mr-2"/> Credits</TabsTrigger>
            <TabsTrigger value="leads"><Database className="w-4 h-4 mr-2"/> Leads</TabsTrigger>
          </TabsList>
          
          <TabsContent value="applications" className="space-y-4">
            <h2 className="text-xl font-serif text-white mb-4">Pending Doll Applications</h2>
            {applications?.map(app => (
              <div key={app.id} className="bg-card/50 border border-white/10 rounded-xl p-6 flex justify-between items-center">
                <div>
                  <p className="font-bold text-white">{app.stageName}</p>
                  <p className="text-sm text-muted-foreground">{app.email} &bull; {app.city}, {app.state}</p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => handleReviewApp(app.id, 'approve')} className="bg-green-600 hover:bg-green-700 text-white">Approve</Button>
                  <Button onClick={() => handleReviewApp(app.id, 'reject')} variant="destructive">Reject</Button>
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
                    <p className="text-sm text-white mb-2">Doll: {media.dollName || 'Unknown'}</p>
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
                <p className="font-bold text-white mb-4">Doll ID: {verif.dollId} - {verif.dollName}</p>
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

          <TabsContent value="credits">
            <AdminCredits />
          </TabsContent>

          <TabsContent value="leads">
            <AdminLeads />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
