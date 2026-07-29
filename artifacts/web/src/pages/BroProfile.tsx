import { Layout } from "@/components/Layout";
import { useParams, Link } from "wouter";
import {
  useGetBroProfile,
  useToggleFollow,
  getGetBroProfileQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FeedPostCard } from "@/components/FeedPostCard";
import { MapPin, Calendar, UserPlus, UserCheck, ShieldCheck, Star, Award, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export default function BroProfile() {
  const { id } = useParams();
  const broId = parseInt(id || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: session } = useGetCurrentUser();
  const isAuthed = session?.authenticated && session.user;
  const isSelf = session?.user?.id === broId;

  const [loginPromptOpen, setLoginPromptOpen] = useState(false);

  const { data: profile, isLoading } = useGetBroProfile(broId, {
    query: { enabled: !!broId, queryKey: getGetBroProfileQueryKey(broId) },
  });

  const toggleFollow = useToggleFollow({
    mutation: {
      onSuccess: () => {
        toast({ title: "Follow status updated" });
        queryClient.invalidateQueries({ queryKey: getGetBroProfileQueryKey(broId) });
      },
      onError: () => toast({ title: "Failed to update", variant: "destructive" }),
    }
  });

  const handleFollow = () => {
    if (!isAuthed) return setLoginPromptOpen(true);
    toggleFollow.mutate({ userId: broId });
  };

  const getBadgeIcon = (badge: string) => {
    if (badge === "verified_bro") return <ShieldCheck className="w-4 h-4 text-primary" />;
    if (badge === "vip_bro") return <Star className="w-4 h-4 text-rose-400" />;
    if (badge === "top_supporter") return <Award className="w-4 h-4 text-secondary" />;
    return null;
  };

  const formatBadgeName = (badge: string) => {
    return badge.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 flex justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!profile) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 text-center">
          <h1 className="font-serif text-3xl text-white mb-4">Bro Not Found</h1>
          <p className="text-muted-foreground">This profile doesn't exist or was removed.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="bg-card/50 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden mb-8 relative">
          <div className="h-32 bg-gradient-to-r from-primary/20 via-background to-secondary/20 border-b border-white/5" />
          <div className="px-6 sm:px-10 pb-10 relative">
            <div className="flex flex-col sm:flex-row gap-6 sm:items-end -mt-16 mb-6">
              <Avatar className="w-32 h-32 border-4 border-card bg-background shrink-0 shadow-xl">
                <AvatarImage src={profile.profilePhotoUrl || ""} className="object-cover" />
                <AvatarFallback className="text-4xl font-serif text-primary bg-background">
                  {profile.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 pb-2">
                <h1 className="text-3xl font-serif font-bold text-white mb-1 flex items-center gap-2">
                  {profile.name}
                </h1>
                <p className="text-primary font-medium">@{profile.username || `bro${profile.id}`}</p>
              </div>
              <div className="pb-2 flex shrink-0">
                {!isSelf && (
                  <Button
                    onClick={handleFollow}
                    disabled={toggleFollow.isPending}
                    variant={profile.viewerFollows ? "outline" : "default"}
                    className={`rounded-full px-8 h-12 font-semibold ${
                      profile.viewerFollows 
                        ? "border-white/20 text-white hover:bg-white/10 hover:text-white" 
                        : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_rgba(212,175,55,0.3)]"
                    }`}
                  >
                    {profile.viewerFollows ? (
                      <><UserCheck className="w-4 h-4 mr-2" /> Following</>
                    ) : (
                      <><UserPlus className="w-4 h-4 mr-2" /> Follow</>
                    )}
                  </Button>
                )}
                {isSelf && (
                  <Link href="/dashboard/member">
                    <Button variant="outline" className="rounded-full border-white/20 text-white hover:bg-white/10">
                      Edit Profile
                    </Button>
                  </Link>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground mb-6">
              {(profile.city || profile.state) && (
                <span className="flex items-center gap-1.5 text-white/80">
                  <MapPin className="w-4 h-4 text-primary" /> {profile.city}{profile.city && profile.state ? ", " : ""}{profile.state}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-white/80">
                <Calendar className="w-4 h-4 text-primary" /> Member since {new Date(profile.memberSince || "").getFullYear()}
              </span>
            </div>

            <div className="flex gap-6 border-y border-white/5 py-4 mb-8">
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-white tabular-nums leading-none mb-1">{profile.followerCount || 0}</span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Followers</span>
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-white tabular-nums leading-none mb-1">{profile.followingCount || 0}</span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Following</span>
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-white tabular-nums leading-none mb-1">{profile.postCount || 0}</span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Posts</span>
              </div>
            </div>

            {profile.badges && profile.badges.length > 0 && (
              <div>
                <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3 font-semibold">Badges</h3>
                <div className="flex flex-wrap gap-2">
                  {profile.badges.map(badge => (
                    <span key={badge} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-white shadow-sm">
                      {getBadgeIcon(badge)} {formatBadgeName(badge)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            <h2 className="font-serif text-2xl text-white mb-6 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" /> Recent Activity
            </h2>
            
            {!profile.posts || profile.posts.length === 0 ? (
              <div className="bg-card/30 border border-white/5 rounded-2xl p-10 text-center">
                <p className="text-muted-foreground">No public posts yet.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {profile.posts.map((post: any) => (
                  <FeedPostCard key={post.id} post={post} onLoginPrompt={() => setLoginPromptOpen(true)} />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <h3 className="font-serif text-lg text-white mb-4">Followed Dolls</h3>
              {!profile.followedDolls || profile.followedDolls.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not following any Dolls publicly.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {profile.followedDolls.map((doll) => (
                    <Link key={doll.id} href={doll.dollId ? `/dolls/${doll.dollId}` : "#"} className="flex items-center gap-3 group">
                      <Avatar className="w-10 h-10 border border-white/10 group-hover:border-primary/50 transition-colors">
                        <AvatarImage src={doll.profilePhotoUrl || ""} className="object-cover" />
                        <AvatarFallback className="bg-background text-primary">{doll.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate group-hover:text-primary transition-colors flex items-center gap-1.5">
                          {doll.name} {doll.verified && <ShieldCheck className="w-3 h-3 text-primary" />}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{doll.city}, {doll.state}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={loginPromptOpen} onOpenChange={setLoginPromptOpen}>
        <DialogContent className="bg-card border-primary/20 shadow-[0_0_50px_rgba(212,175,55,0.15)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" /> Join the Lounge
            </DialogTitle>
            <DialogDescription className="text-base">
              You need an account to interact with members.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-4">
            <Link href="/signup/member">
              <Button className="w-full h-12 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
                Become a Member
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" className="w-full h-12 text-base font-semibold border-white/20 text-white hover:bg-white/10">
                Log in
              </Button>
            </Link>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
