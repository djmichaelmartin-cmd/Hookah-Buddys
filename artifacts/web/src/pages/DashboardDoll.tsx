import { Layout } from "@/components/Layout";
import { useGetMyDollProfile, useGetMyDollAnalytics } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Upload, MessageSquare, Video } from "lucide-react";

export default function DashboardDoll() {
  const { data: profile, isLoading: loadingProfile } = useGetMyDollProfile();
  const { data: analytics } = useGetMyDollAnalytics();

  if (loadingProfile) return <Layout><div className="p-12 text-center text-muted-foreground">Loading...</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-serif text-white">Doll Dashboard</h1>
          <Link href="/upload"><Button className="bg-primary"><Upload className="w-4 h-4 mr-2" /> Upload Content</Button></Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2">Total Earnings</h3>
            <p className="text-3xl font-bold text-primary">${analytics?.totalEarnings || 0}</p>
          </div>
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2">Profile Views</h3>
            <p className="text-3xl font-bold text-white">{analytics?.profileViews || 0}</p>
          </div>
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2">Favorites</h3>
            <p className="text-3xl font-bold text-white">{analytics?.favorites || 0}</p>
          </div>
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2">Unlocks</h3>
            <p className="text-3xl font-bold text-white">{analytics?.contentUnlocks || 0}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
             <h2 className="text-xl font-serif text-white mb-4">Quick Links</h2>
             <div className="space-y-4">
                <Link href="/messages" className="flex items-center gap-3 p-4 bg-white/5 hover:bg-white/10 rounded-lg text-white transition-colors">
                  <MessageSquare className="w-5 h-5 text-primary" /> Messages
                </Link>
                <Link href="/video-chat" className="flex items-center gap-3 p-4 bg-white/5 hover:bg-white/10 rounded-lg text-white transition-colors">
                  <Video className="w-5 h-5 text-secondary" /> Video Chat Requests
                </Link>
                <Link href="/verification" className="flex items-center gap-3 p-4 bg-white/5 hover:bg-white/10 rounded-lg text-white transition-colors">
                  <ShieldCheck className="w-5 h-5 text-green-400" /> Verification Status
                </Link>
             </div>
          </div>
          
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
             <h2 className="text-xl font-serif text-white mb-4">Profile Status</h2>
             <p className="text-muted-foreground mb-4">Stage Name: <span className="text-white">{profile?.stageName}</span></p>
             <p className="text-muted-foreground mb-4">Verified: <span className="text-white">{profile?.verified ? "Yes" : "No"}</span></p>
             <p className="text-muted-foreground mb-4">Tier: <span className="text-white capitalize">{profile?.tier}</span></p>
             <Link href="/pricing"><Button variant="outline" className="w-full">Upgrade Tier</Button></Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
