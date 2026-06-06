import { Layout } from "@/components/Layout";
import {
  useGetDoll,
  getGetDollQueryKey,
  useGetCurrentUser,
  useListPlans,
  useUnlockContent,
  useCreateSubscription,
  type Media,
} from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, MessageSquare, Video, Star, Lock, Play, ImageIcon } from "lucide-react";

const VIDEO_TYPES = new Set(["premium_video", "short_video"]);

function isVideo(m: Media) {
  return VIDEO_TYPES.has(m.type);
}

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

  const refetchDoll = () =>
    queryClient.invalidateQueries({ queryKey: getGetDollQueryKey(dollId) });

  const unlock = useUnlockContent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Content unlocked", description: "Enjoy the full content." });
        refetchDoll();
      },
      onError: () => toast({ title: "Unlock failed", description: "Please try again.", variant: "destructive" }),
    },
  });

  const subscribe = useCreateSubscription({
    mutation: {
      onSuccess: () => {
        toast({ title: "Subscribed", description: "You now have full access to this Doll's content." });
        refetchDoll();
      },
      onError: () => toast({ title: "Subscription failed", description: "Please try again.", variant: "destructive" }),
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
        <div className="container p-12 text-center text-muted-foreground">Doll not found</div>
      </Layout>
    );

  const media = (doll.media ?? []).filter((m) => m.type !== "profile" && m.type !== "verification");
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
      plans?.find((p) => p.audience === "member" && p.tier === "premium") ??
      plans?.find((p) => p.audience === "member");
    if (!memberPlan) {
      toast({ title: "No plan available", description: "Please try again later.", variant: "destructive" });
      return;
    }
    subscribe.mutate({ data: { planId: memberPlan.id, dollId } });
  };

  const handleUnlock = (m: Media) => {
    if (!session?.user) {
      navigate("/login");
      return;
    }
    if (!isMember) {
      toast({ title: "Members only", description: "Sign in as a member to unlock content.", variant: "destructive" });
      return;
    }
    unlock.mutate({ data: { mediaId: m.id } });
  };

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
                <Button variant="outline" className="w-full border-primary/50 text-primary hover:bg-primary/10">
                  <MessageSquare className="w-4 h-4 mr-2" /> Message
                </Button>
                <Button variant="outline" className="w-full border-secondary/50 text-secondary hover:bg-secondary/10">
                  <Video className="w-4 h-4 mr-2" /> Request Video Chat
                </Button>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="w-full md:w-2/3 space-y-8">
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
                <span className="text-xs text-muted-foreground">{media.length} items</span>
              </div>

              {media.length === 0 ? (
                <p className="text-muted-foreground">No content posted yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {media.map((m) => (
                    <MediaTile
                      key={m.id}
                      media={m}
                      stageName={doll.stageName}
                      onUnlock={() => handleUnlock(m)}
                      unlocking={unlock.isPending && unlock.variables?.data.mediaId === m.id}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function MediaTile({
  media,
  stageName,
  onUnlock,
  unlocking,
}: {
  media: Media;
  stageName: string;
  onUnlock: () => void;
  unlocking: boolean;
}) {
  const video = isVideo(media);

  if (media.locked) {
    return (
      <div className="relative aspect-square rounded-lg overflow-hidden border border-white/10 group">
        {media.thumbnailUrl ? (
          <img
            src={media.thumbnailUrl}
            alt={`${stageName} premium content`}
            className="object-cover w-full h-full blur-xl scale-110"
          />
        ) : (
          <div className="w-full h-full bg-card" />
        )}
        <div className="absolute inset-0 bg-background/60 flex flex-col items-center justify-center gap-2 p-3 text-center">
          <Lock className="w-6 h-6 text-primary" />
          <p className="text-[11px] text-muted-foreground">
            {video ? "Premium video" : "Premium photo"}
          </p>
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
            onClick={onUnlock}
            disabled={unlocking}
          >
            {unlocking ? "Unlocking..." : `Unlock${media.price ? ` $${media.price}` : ""}`}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-card">
      {video ? (
        media.url ? (
          <video src={media.url} controls playsInline className="object-cover w-full h-full" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Play className="w-8 h-8 text-muted-foreground/40" />
          </div>
        )
      ) : media.url ? (
        <img src={media.url} alt={media.caption || `${stageName} content`} className="object-cover w-full h-full" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
        </div>
      )}
      {media.premium && (
        <span className="absolute top-2 left-2 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
          Premium
        </span>
      )}
    </div>
  );
}
