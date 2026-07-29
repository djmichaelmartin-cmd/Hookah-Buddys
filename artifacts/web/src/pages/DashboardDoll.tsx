import { Layout } from "@/components/Layout";
import { useGetMyDollProfile, useGetMyDollAnalytics, useListMyFeedPosts, useListSavedFeedPosts, useGetMyFeedStats } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Upload, MessageSquare, Video, Users, Bookmark, FileText } from "lucide-react";
import { FeedPostCard } from "@/components/FeedPostCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function DashboardDoll() {
  const { data: profile, isLoading: loadingProfile } = useGetMyDollProfile();
  const { data: analytics } = useGetMyDollAnalytics();
  
  const { data: myPosts } = useListMyFeedPosts();
  const { data: savedPosts } = useListSavedFeedPosts();
  const { data: feedStats } = useGetMyFeedStats();

  if (loadingProfile) return <Layout><div className="p-12 text-center text-muted-foreground">Loading...</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-serif text-white">Doll Dashboard</h1>
          <Link href="/upload"><Button className="bg-primary text-primary-foreground"><Upload className="w-4 h-4 mr-2" /> Upload Content</Button></Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-card/50 border border-white/10 rounded-xl p-5">
            <h3 className="text-sm text-muted-foreground mb-1">Total Earnings</h3>
            <p className="text-2xl font-bold text-primary">${analytics?.totalEarnings || 0}</p>
          </div>
          <div className="bg-card/50 border border-white/10 rounded-xl p-5">
            <h3 className="text-sm text-muted-foreground mb-1">Profile Views</h3>
            <p className="text-2xl font-bold text-white">{analytics?.profileViews || 0}</p>
          </div>
          <div className="bg-card/50 border border-white/10 rounded-xl p-5">
            <h3 className="text-sm text-muted-foreground mb-1">Followers</h3>
            <p className="text-2xl font-bold text-white">{feedStats?.followerCount || 0}</p>
          </div>
          <div className="bg-card/50 border border-white/10 rounded-xl p-5">
            <h3 className="text-sm text-muted-foreground mb-1">Post Likes</h3>
            <p className="text-2xl font-bold text-white">{feedStats?.likesReceived || 0}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-card/50 border border-white/10 rounded-xl p-6">
               <h2 className="text-xl font-serif text-white mb-4">Quick Links</h2>
               <div className="space-y-3">
                  <Link href="/members" className="flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 rounded-lg text-white transition-colors">
                    <Users className="w-4 h-4 text-primary" /> Member Directory
                  </Link>
                  <Link href="/messages" className="flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 rounded-lg text-white transition-colors">
                    <MessageSquare className="w-4 h-4 text-primary" /> Messages
                  </Link>
                  <Link href="/video-chat" className="flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 rounded-lg text-white transition-colors">
                    <Video className="w-4 h-4 text-secondary" /> Video Chat Requests
                  </Link>
                  <Link href="/verification" className="flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 rounded-lg text-white transition-colors">
                    <ShieldCheck className="w-4 h-4 text-green-400" /> Verification Status
                  </Link>
               </div>
            </div>
            
            <div className="bg-card/50 border border-white/10 rounded-xl p-6">
               <h2 className="text-xl font-serif text-white mb-4">Profile Status</h2>
               <div className="space-y-3 mb-6 text-sm">
                 <p className="text-muted-foreground flex justify-between">Stage Name <span className="text-white">{profile?.stageName}</span></p>
                 <p className="text-muted-foreground flex justify-between">Verified <span className="text-white">{profile?.verified ? "Yes" : "No"}</span></p>
                 <p className="text-muted-foreground flex justify-between">Tier <span className="text-white capitalize">{profile?.tier}</span></p>
               </div>
               <Link href="/pricing"><Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10">Upgrade Tier</Button></Link>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-card/50 border border-white/10 rounded-xl p-6 min-h-[600px]">
              <Tabs defaultValue="myposts" className="w-full">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-serif text-white">Community Feed</h2>
                  <TabsList className="bg-background/50 border border-white/10">
                    <TabsTrigger value="myposts" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">My Posts</TabsTrigger>
                    <TabsTrigger value="saved" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Saved</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="myposts" className="mt-0 outline-none space-y-6">
                  {myPosts?.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground flex flex-col items-center border border-dashed border-white/10 rounded-xl bg-background/20">
                      <FileText className="w-8 h-8 mb-3 opacity-20" />
                      <p>You haven't posted anything to the feed yet.</p>
                      <Link href="/feed"><Button variant="outline" size="sm" className="mt-4 border-white/20">Go to Feed</Button></Link>
                    </div>
                  ) : (
                    myPosts?.map(post => <FeedPostCard key={post.id} post={post} onLoginPrompt={() => {}} />)
                  )}
                </TabsContent>

                <TabsContent value="saved" className="mt-0 outline-none space-y-6">
                  {savedPosts?.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground flex flex-col items-center border border-dashed border-white/10 rounded-xl bg-background/20">
                      <Bookmark className="w-8 h-8 mb-3 opacity-20" />
                      <p>You haven't saved any posts yet.</p>
                    </div>
                  ) : (
                    savedPosts?.map(post => <FeedPostCard key={post.id} post={post} onLoginPrompt={() => {}} />)
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
