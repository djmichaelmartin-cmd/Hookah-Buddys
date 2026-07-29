import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useGetCredits, useListFavorites, type CreditTransaction, useListMyFeedPosts, useListSavedFeedPosts, useListLikedFeedPosts, useListFollows, getListFollowsQueryKey, useGetCurrentUser } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BuyCreditsDialog } from "@/components/BuyCreditsDialog";
import { Coins, ArrowDownCircle, ArrowUpCircle, Settings2, RefreshCw, CalendarClock, UserPlus, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FeedPostCard } from "@/components/FeedPostCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function formatWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function TransactionRow({ tx }: { tx: CreditTransaction }) {
  const positive = tx.amount >= 0;
  const Icon = tx.type === "adjustment" ? Settings2 : positive ? ArrowDownCircle : ArrowUpCircle;
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${positive ? "text-green-400" : "text-secondary"}`} />
        <div>
          <p className="text-sm text-white">{tx.description || (positive ? "Credits added" : "Credits spent")}</p>
          <p className="text-xs text-muted-foreground capitalize">{tx.type} &bull; {formatWhen(tx.createdAt)}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={`text-sm font-semibold ${positive ? "text-green-400" : "text-secondary"}`}>
          {positive ? "+" : ""}{tx.amount} cr
        </p>
        {tx.amountCents != null && tx.amountCents > 0 && (
          <p className="text-xs text-muted-foreground">${(tx.amountCents / 100).toFixed(2)}</p>
        )}
      </div>
    </div>
  );
}

export default function DashboardMember() {
  const { data: session } = useGetCurrentUser();
  const userId = session?.user?.id ?? 0;

  const { data: credits } = useGetCredits();
  const { data: favorites } = useListFavorites();
  const { data: myPosts } = useListMyFeedPosts();
  const { data: savedPosts } = useListSavedFeedPosts();
  const { data: likedPosts } = useListLikedFeedPosts();
  const { data: following } = useListFollows({ userId, direction: "following" }, { query: { enabled: !!userId, queryKey: getListFollowsQueryKey({ userId, direction: "following" }) } });
  const { data: followers } = useListFollows({ userId, direction: "followers" }, { query: { enabled: !!userId, queryKey: getListFollowsQueryKey({ userId, direction: "followers" }) } });

  const [buyOpen, setBuyOpen] = useState(false);

  const transactions = credits?.transactions ?? [];
  const purchases = transactions.filter((t) => t.type === "purchase");
  const usage = transactions.filter((t) => t.type !== "purchase");

  const membershipBalance = credits?.membershipBalance ?? 0;
  const purchasedBalance = credits?.purchasedBalance ?? 0;
  const monthlyMembershipCredits = credits?.monthlyMembershipCredits ?? 0;
  const membershipPlanName = credits?.membershipPlanName ?? null;
  const nextRefreshAt = credits?.nextRefreshAt ?? null;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-3xl font-serif text-white mb-8">Member Dashboard</h1>

        <Tabs defaultValue="credits" className="w-full">
          <TabsList className="bg-card/50 border border-white/10 mb-8 overflow-x-auto flex flex-nowrap w-full md:w-auto h-auto p-1 sticky top-[100px] z-20 backdrop-blur-xl">
            <TabsTrigger value="credits" className="px-6 py-2.5 rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white whitespace-nowrap">Credits & Billing</TabsTrigger>
            <TabsTrigger value="feed" className="px-6 py-2.5 rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white whitespace-nowrap">My Posts & Activity</TabsTrigger>
            <TabsTrigger value="network" className="px-6 py-2.5 rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white whitespace-nowrap">Network</TabsTrigger>
          </TabsList>

          <TabsContent value="credits" className="mt-0 outline-none">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-card/50 border border-white/10 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                    <Coins className="w-4 h-4 text-primary" /> Current Balance
                  </h3>
                  <p className="text-3xl font-bold text-primary">{credits?.balance ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-1">membership + purchased credits</p>
                </div>
                <Button
                  size="sm"
                  className="mt-4 w-full bg-primary text-primary-foreground"
                  onClick={() => setBuyOpen(true)}
                >
                  Buy Credits
                </Button>
              </div>

              <div className="bg-card/50 border border-white/10 rounded-xl p-6">
                <h3 className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-primary" /> Membership Credits
                </h3>
                <p className="text-3xl font-bold text-white">
                  {membershipBalance}
                  {monthlyMembershipCredits > 0 && (
                    <span className="text-base text-muted-foreground font-normal"> / {monthlyMembershipCredits}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {monthlyMembershipCredits > 0
                    ? `Included with ${membershipPlanName ?? "your membership"} • expires each cycle`
                    : "No active membership credits"}
                </p>
              </div>

              <div className="bg-card/50 border border-white/10 rounded-xl p-6">
                <h3 className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                  <Coins className="w-4 h-4 text-primary" /> Purchased Credits
                </h3>
                <p className="text-3xl font-bold text-white">{purchasedBalance}</p>
                <p className="text-xs text-muted-foreground mt-1">never expire</p>
              </div>

              <div className="bg-card/50 border border-white/10 rounded-xl p-6">
                <h3 className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-primary" /> Next Refresh
                </h3>
                <p className="text-2xl font-bold text-white">
                  {nextRefreshAt ? formatWhen(nextRefreshAt) : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {nextRefreshAt ? "membership credits reset" : "subscribe for monthly credits"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card/50 border border-white/10 rounded-xl p-6">
                <h2 className="text-xl font-serif text-white mb-4">Purchase History</h2>
                {purchases.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No purchases yet. <button className="text-primary underline" onClick={() => setBuyOpen(true)}>Buy your first credits</button>.
                  </p>
                ) : (
                  <div>{purchases.map((tx) => <TransactionRow key={tx.id} tx={tx} />)}</div>
                )}
              </div>

              <div className="bg-card/50 border border-white/10 rounded-xl p-6">
                <h2 className="text-xl font-serif text-white mb-4">Usage History</h2>
                {usage.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No credit activity yet.</p>
                ) : (
                  <div>{usage.map((tx) => <TransactionRow key={tx.id} tx={tx} />)}</div>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-6">
              Looking for memberships and plans? <Link href="/pricing" className="text-primary underline">View pricing</Link>.
            </p>
          </TabsContent>

          <TabsContent value="feed" className="mt-0 outline-none">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              <div className="lg:col-span-1">
                <div className="bg-card/50 border border-white/10 rounded-xl p-6 sticky top-[160px]">
                  <h2 className="text-xl font-serif text-white mb-4">Feed Stats</h2>
                  <div className="space-y-4 text-sm">
                    <div className="flex justify-between pb-3 border-b border-white/5">
                      <span className="text-muted-foreground">My Posts</span>
                      <span className="text-white font-medium">{myPosts?.length || 0}</span>
                    </div>
                    <div className="flex justify-between pb-3 border-b border-white/5">
                      <span className="text-muted-foreground">Saved Posts</span>
                      <span className="text-white font-medium">{savedPosts?.length || 0}</span>
                    </div>
                    <div className="flex justify-between pb-3 border-b border-white/5">
                      <span className="text-muted-foreground">Liked Posts</span>
                      <span className="text-white font-medium">{likedPosts?.length || 0}</span>
                    </div>
                    <Link href={`/bros/${userId}`}>
                      <Button variant="outline" className="w-full mt-2 border-white/20 hover:bg-white/10 text-white">
                        View Public Profile
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-3">
                <Tabs defaultValue="myposts" className="w-full bg-card/50 border border-white/10 rounded-xl p-6 min-h-[600px]">
                  <TabsList className="bg-background/50 border border-white/10 mb-6">
                    <TabsTrigger value="myposts" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">My Posts</TabsTrigger>
                    <TabsTrigger value="saved" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Saved</TabsTrigger>
                    <TabsTrigger value="liked" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Liked</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="myposts" className="space-y-6 mt-0">
                    {myPosts?.length === 0 ? <p className="text-muted-foreground text-center py-10">You haven't posted yet.</p> : myPosts?.map(post => <FeedPostCard key={post.id} post={post} onLoginPrompt={() => {}} />)}
                  </TabsContent>
                  <TabsContent value="saved" className="space-y-6 mt-0">
                    {savedPosts?.length === 0 ? <p className="text-muted-foreground text-center py-10">No saved posts.</p> : savedPosts?.map(post => <FeedPostCard key={post.id} post={post} onLoginPrompt={() => {}} />)}
                  </TabsContent>
                  <TabsContent value="liked" className="space-y-6 mt-0">
                    {likedPosts?.length === 0 ? <p className="text-muted-foreground text-center py-10">No liked posts.</p> : likedPosts?.map(post => <FeedPostCard key={post.id} post={post} onLoginPrompt={() => {}} />)}
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="network" className="mt-0 outline-none">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-card/50 border border-white/10 rounded-xl p-6">
                <h2 className="text-xl font-serif text-white mb-6 flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-primary" /> Following ({following?.length || 0})
                </h2>
                {following?.length === 0 ? (
                  <p className="text-muted-foreground text-sm">You are not following anyone.</p>
                ) : (
                  <div className="space-y-4">
                    {following?.map(user => (
                      <Link key={user.id} href={user.role === 'doll' ? `/dolls/${user.dollId}` : `/bros/${user.id}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors group">
                        <Avatar className="h-10 w-10 border border-white/10 group-hover:border-primary/50">
                          <AvatarImage src={user.profilePhotoUrl || ""} />
                          <AvatarFallback className="bg-background text-primary text-xs">{user.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-white flex items-center gap-1.5">{user.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-card/50 border border-white/10 rounded-xl p-6">
                <h2 className="text-xl font-serif text-white mb-6 flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" /> Followers ({followers?.length || 0})
                </h2>
                {followers?.length === 0 ? (
                  <p className="text-muted-foreground text-sm">You have no followers yet.</p>
                ) : (
                  <div className="space-y-4">
                    {followers?.map(user => (
                      <Link key={user.id} href={user.role === 'doll' ? `/dolls/${user.dollId}` : `/bros/${user.id}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors group">
                        <Avatar className="h-10 w-10 border border-white/10 group-hover:border-primary/50">
                          <AvatarImage src={user.profilePhotoUrl || ""} />
                          <AvatarFallback className="bg-background text-primary text-xs">{user.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-white flex items-center gap-1.5">{user.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <BuyCreditsDialog open={buyOpen} onOpenChange={setBuyOpen} />
    </Layout>
  );
}
