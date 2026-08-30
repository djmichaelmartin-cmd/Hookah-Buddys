import { useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useGetDoll,
  getGetDollQueryKey,
  useGetCurrentUser,
  useListPlans,
  useListSubscriptions,
  getListSubscriptionsQueryKey,
  useCreateSubscription,
  useCreateThread,
  useRequestVideoChat,
  useEstimateVideoChat,
  getEstimateVideoChatQueryKey,
  getGetCreditsQueryKey,
  useListFeedPosts,
  getListFeedPostsQueryKey,
  useListReels,
  getListReelsQueryKey,
  useGetCreatorRequestAvailability,
  getGetCreatorRequestAvailabilityQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FeedPostCard } from "@/components/FeedPostCard";
import { SparkCard } from "@/components/sparks/SparkCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { BuyCreditsDialog } from "@/components/BuyCreditsDialog";
import { isCheckoutRequired } from "@/lib/checkoutRequired";
import { ShieldCheck, MessageSquare, Video, Star, Check, Sparkles, Coins, Zap } from "lucide-react";

function serverError(err: unknown): string | undefined {
  if (err instanceof ApiError && err.data && typeof err.data === "object" && "error" in err.data) {
    const e = (err.data as { error: unknown }).error;
    if (typeof e === "string") return e;
  }
  return undefined;
}

function isOutOfCredits(err: unknown): boolean {
  return err instanceof ApiError && err.status === 402;
}

import { DollProfileAlbums } from "@/components/creator/DollProfileAlbums";
import { CustomRequestDialog } from "@/components/creator/CustomRequestDialog";

export default function DollProfile() {
  const { id } = useParams();
  const dollId = parseInt(id || "0", 10);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: doll, isLoading } = useGetDoll(dollId, {
    query: { enabled: !!dollId, queryKey: getGetDollQueryKey(dollId) },
  });
  const { data: session } = useGetCurrentUser();
  const { data: plans } = useListPlans();

  const role = session?.user?.role;
  const isMember = role === "member";

  const [buyOpen, setBuyOpen] = useState(false);

  const refetchDoll = () => {
    queryClient.invalidateQueries({ queryKey: getGetDollQueryKey(dollId) });
    queryClient.invalidateQueries({ queryKey: getGetCreditsQueryKey() });
  };

  const handleCreditError = (err: unknown, fallbackTitle: string) => {
    if (isCheckoutRequired(err)) {
      toast({
        title: "Payment required",
        description: "This purchase must be completed through secure checkout.",
      });
      navigate("/pricing");
      return;
    }
    if (isOutOfCredits(err)) {
      toast({
        title: "Not enough credits",
        description: serverError(err) ?? "Buy more credits to continue.",
        variant: "destructive",
      });
      setBuyOpen(true);
      return;
    }
    toast({ title: fallbackTitle, description: serverError(err) ?? "Please try again.", variant: "destructive" });
  };

  const subscribe = useCreateSubscription({
    mutation: {
      onSuccess: () => {
        toast({ title: "Subscribed", description: "You now have full access to this Buddy's content." });
        refetchDoll();
      },
      onError: (err) => {
        if (isCheckoutRequired(err)) {
          const slug = plans?.find((p) => p.id === subscribe.variables?.data.planId)?.slug;
          toast({
            title: "Payment required",
            description: "Complete secure checkout to activate this membership.",
          });
          navigate(slug ? `/checkout?type=membership&plan=${slug}` : "/pricing");
          return;
        }
        toast({ title: "Subscription failed", description: "Please try again.", variant: "destructive" });
      },
    },
  });

  const { data: subscriptions, isPending: subscriptionsPending } = useListSubscriptions({
    query: { enabled: isMember, queryKey: getListSubscriptionsQueryKey() },
  });
  const isPayingMember = (subscriptions ?? []).some(
    (s) => s.audience === "member" && s.status === "active" && !s.dollId && (s.price ?? 0) > 0,
  );

  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const upgrade = useCreateSubscription({
    mutation: {
      onSuccess: () => {
        toast({ title: "Membership upgraded", description: "You can now message and request video chats." });
        setUpgradeOpen(false);
        queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
      },
      onError: (err) => {
        if (isCheckoutRequired(err)) {
          const slug = plans?.find((p) => p.id === upgrade.variables?.data.planId)?.slug;
          setUpgradeOpen(false);
          toast({
            title: "Payment required",
            description: "Complete secure checkout to activate this membership.",
          });
          navigate(slug ? `/checkout?type=membership&plan=${slug}` : "/pricing");
          return;
        }
        toast({ title: "Upgrade failed", description: "Please try again.", variant: "destructive" });
      },
    },
  });

  const startThread = useCreateThread({
    mutation: {
      onSuccess: () => navigate("/messages"),
      onError: () => toast({ title: "Couldn't open chat", description: "Please try again.", variant: "destructive" }),
    },
  });

  const requestVideo = useRequestVideoChat({
    mutation: {
      onSuccess: (session) => {
        toast({ title: "Video chat requested", description: "Joining the lounge..." });
        queryClient.invalidateQueries({ queryKey: getGetCreditsQueryKey() });
        navigate(`/video-chat/${session.id}`);
      },
      onError: (err) => handleCreditError(err, "Request failed"),
    },
  });

  const { data: videoEstimate } = useEstimateVideoChat(undefined, {
    query: { enabled: isMember, queryKey: getEstimateVideoChatQueryKey() },
  });

  const { data: rawFeedPosts, isLoading: postsLoading } = useListFeedPosts({ filter: "dolls" }, {
    query: { enabled: true, queryKey: getListFeedPostsQueryKey({ filter: "dolls" }) }
  });
  const dollFeedPosts = rawFeedPosts?.filter(p => p.dollId === dollId) ?? [];

  const { data: sparks, isLoading: sparksLoading } = useListReels(
    { dollId: dollId, visibility: 'public' },
    { query: { enabled: !!dollId, queryKey: getListReelsQueryKey({ dollId: dollId, visibility: 'public' }) } }
  );

  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const creatorUserId = doll?.creatorUserId ?? 0;
  const { data: requestAvailability } = useGetCreatorRequestAvailability(creatorUserId, {
    query: {
      enabled: creatorUserId > 0,
      queryKey: getGetCreatorRequestAvailabilityQueryKey(creatorUserId),
    },
  });

  if (isLoading)
    return (
      <Layout>
        <div className="container p-12 text-center text-muted-foreground">Loading...</div>
      </Layout>
    );
  if (!doll)
    return (
      <Layout>
        <div className="container p-12 text-center text-muted-foreground">Buddy not found</div>
      </Layout>
    );

  const subscribed = doll.viewerSubscribed ?? false;

  const handleSubscribe = () => {
    if (!session?.user) {
      navigate("/login");
      return;
    }
    if (!isMember) {
      toast({ title: "Members only", description: "Sign in as a member to subscribe.", variant: "destructive" });
      return;
    }
    const memberPlan =
      plans?.find((p) => p.audience === "member" && p.tier === "gold") ??
      plans?.find((p) => p.audience === "member" && p.tier === "platinum") ??
      plans?.find((p) => p.audience === "member");
    if (!memberPlan) {
      toast({ title: "No plan available", description: "Please try again later.", variant: "destructive" });
      return;
    }
    subscribe.mutate({ data: { planId: memberPlan.id, dollId } });
  };

  const handleRequestContent = () => {
    if (!session?.user) {
      navigate("/login");
      return;
    }
    if (!isMember) {
      toast({ title: "Members only", description: "Sign in as a member to request content.", variant: "destructive" });
      return;
    }
    setRequestOpen(true);
  };

  const requirePaidMember = (action: () => void) => {
    if (!session?.user) {
      navigate("/login");
      return;
    }
    if (!isMember) {
      toast({ title: "Members only", description: "Sign in as a member to use this feature.", variant: "destructive" });
      return;
    }
    if (subscriptionsPending) {
      toast({ title: "One moment", description: "Checking your membership..." });
      return;
    }
    if (!isPayingMember) {
      setUpgradeOpen(true);
      return;
    }
    action();
  };

  const handleMessage = () => requirePaidMember(() => startThread.mutate({ data: { dollId } }));
  const handleVideoChat = () =>
    requirePaidMember(() =>
      requestVideo.mutate({ data: { dollId, scheduledAt: new Date().toISOString() } }),
    );

  const memberPlans = (plans ?? []).filter(
    (p) => p.audience === "member" && (p.tier === "gold" || p.tier === "platinum"),
  );

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <div className="flex flex-col md:flex-row gap-12">
          {/* Profile Sidebar */}
          <div className="w-full md:w-1/3 space-y-6">
            <div className="rounded-2xl overflow-hidden border border-white/10 aspect-[3/4] bg-card relative">
              {doll.profilePhotoUrl ? (
                <img src={doll.profilePhotoUrl} alt={doll.stageName} className="object-cover w-full h-full" />
              ) : (
                <div className="w-full h-full bg-card flex items-center justify-center">
                  <Star className="w-12 h-12 text-muted-foreground/30" />
                </div>
              )}
            </div>
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-3xl font-serif text-white font-bold">{doll.stageName}</h1>
                {doll.verified && <ShieldCheck className="w-6 h-6 text-primary" />}
              </div>
              <p className="text-muted-foreground mb-4">
                {doll.city}, {doll.state} &bull; {doll.age} yrs
              </p>
              <div className="space-y-3">
                {subscribed ? (
                  <div className="flex items-center justify-center gap-2 w-full rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
                    <ShieldCheck className="w-4 h-4" /> Subscribed
                  </div>
                ) : (
                  <Button
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={handleSubscribe}
                    disabled={subscribe.isPending}
                  >
                    <Star className="w-4 h-4 mr-2" />
                    {subscribe.isPending
                      ? "Subscribing..."
                      : `Subscribe${doll.subscriptionPrice ? ` · $${doll.subscriptionPrice}/mo` : ""}`}
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="w-full border-primary/50 text-primary hover:bg-primary/10"
                  onClick={handleMessage}
                  disabled={startThread.isPending}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  {startThread.isPending ? "Opening..." : "Message"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full border-secondary/50 text-secondary hover:bg-secondary/10"
                  onClick={handleVideoChat}
                  disabled={requestVideo.isPending}
                >
                  <Video className="w-4 h-4 mr-2" />
                  {requestVideo.isPending ? "Requesting..." : "Request Video Chat"}
                </Button>
                {isMember && videoEstimate && (
                  <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
                    <Coins className="w-3 h-3 text-primary" />
                    {videoEstimate.creditsPerMinute} credits/min &bull; {videoEstimate.minMinutes} min minimum ({videoEstimate.totalCredits} credits)
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="w-full md:w-2/3 space-y-8">
            <Tabs defaultValue="about" className="w-full">
              <TabsList className="bg-card/50 backdrop-blur-md border border-white/10 w-full justify-start rounded-xl p-1 h-auto mb-6 flex-wrap">
                <TabsTrigger value="about" className="rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white py-2.5 px-6">About & Content</TabsTrigger>
                <TabsTrigger value="posts" className="rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white py-2.5 px-6">Public Posts <span className="ml-2 bg-primary/20 text-primary text-[10px] px-2 py-0.5 rounded-full">{dollFeedPosts.length}</span></TabsTrigger>
                <TabsTrigger value="sparks" className="rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white py-2.5 px-6">Public Sparks <span className="ml-2 bg-primary/20 text-primary text-[10px] px-2 py-0.5 rounded-full">{sparks?.length || 0}</span></TabsTrigger>
              </TabsList>

              <TabsContent value="about" className="space-y-8 mt-0 outline-none">
                <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-xl p-6">
                  <h2 className="text-xl font-serif text-white mb-4">About Me</h2>
                  <p className="text-muted-foreground whitespace-pre-wrap">{doll.bio || "No bio provided."}</p>
                  <div className="mt-6 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Favorite Flavor</p>
                      <p className="text-white font-medium">{doll.favoriteFlavor || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Experience</p>
                      <p className="text-white font-medium">{doll.experienceLevel || "N/A"}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-serif text-white">Content</h2>
                  </div>

                  {creatorUserId ? (
                    <DollProfileAlbums
                      creatorUserId={creatorUserId}
                      onUnlockError={(err) => handleCreditError(err, "Failed to unlock album")}
                      onRequest={handleRequestContent}
                      requestsAvailable={Boolean(
                        requestAvailability?.enabled && requestAvailability.onlineEligible,
                      )}
                      requestPrice={requestAvailability?.photoPriceCredits}
                    />
                  ) : (
                    <p className="text-muted-foreground text-sm">Albums are temporarily unavailable for this creator.</p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="posts" className="space-y-6 mt-0 outline-none">
                <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-xl p-6 mb-6">
                  <h2 className="text-xl font-serif text-white mb-2">Lounge Posts</h2>
                  <p className="text-sm text-muted-foreground">Public posts by {doll.stageName} in the HookahBuddys Lounge.</p>
                </div>

                {postsLoading ? (
                  <div className="text-center text-muted-foreground py-10">Loading posts...</div>
                ) : dollFeedPosts.length === 0 ? (
                  <div className="text-center text-muted-foreground py-10 bg-card/30 rounded-xl border border-white/5">
                    No public posts yet.
                  </div>
                ) : (
                  <div className="space-y-6">
                    {dollFeedPosts.map(post => (
                      <FeedPostCard key={post.id} post={post} onLoginPrompt={() => setLoginPromptOpen(true)} />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="sparks" className="space-y-6 mt-0 outline-none">
                <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-xl p-6 mb-6">
                  <h2 className="text-xl font-serif text-white mb-2 flex items-center gap-2"><Zap className="w-5 h-5 text-primary fill-primary" /> Public Sparks</h2>
                  <p className="text-sm text-muted-foreground">Free, public moments shared by {doll.stageName}.</p>
                </div>

                {sparksLoading ? (
                  <div className="text-center text-muted-foreground py-10">Loading Sparks...</div>
                ) : !sparks || sparks.length === 0 ? (
                  <div className="text-center text-muted-foreground py-10 bg-card/30 rounded-xl border border-white/5">
                    No public Sparks yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {sparks.map(spark => (
                      <SparkCard key={spark.id} spark={spark} onClick={() => navigate(`/sparks/${spark.id}`)} />
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="bg-card border-white/10 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" /> Upgrade your membership
            </DialogTitle>
            <DialogDescription>

              Messaging and video chat are for premium "I Love Buddys" members. Upgrade to unlock them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {memberPlans.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upgrade plans available right now.</p>
            ) : (
              memberPlans.map((plan) => (
                <div
                  key={plan.id}
                  className="rounded-xl border border-primary/30 bg-background/40 p-5"
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <h3 className="font-serif text-lg text-white">{plan.name}</h3>
                    <p className="text-primary font-bold">
                      ${plan.price}
                      <span className="text-xs text-muted-foreground font-normal">/{plan.interval ?? "mo"}</span>
                    </p>
                  </div>
                  {plan.description && (
                    <p className="text-sm text-muted-foreground mb-3">{plan.description}</p>
                  )}
                  {plan.features && plan.features.length > 0 && (
                    <ul className="space-y-1.5 mb-4">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm text-zinc-300">
                          <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" /> {f}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={() => upgrade.mutate({ data: { planId: plan.id } })}
                    disabled={upgrade.isPending}
                  >
                    {upgrade.isPending ? "Upgrading..." : `Upgrade to ${plan.name}`}
                  </Button>
                </div>
              ))
            )}
            <Button
              variant="ghost"
              className="w-full text-muted-foreground hover:text-white"
              onClick={() => navigate("/pricing")}
            >
              Compare all plans
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BuyCreditsDialog open={buyOpen} onOpenChange={setBuyOpen} />
      {creatorUserId > 0 && (
        <CustomRequestDialog
          creatorUserId={creatorUserId}
          open={requestOpen}
          onOpenChange={setRequestOpen}
          onCreditError={(err) => handleCreditError(err, "Failed to send request")}
        />
      )}
    </Layout>
  );
}

