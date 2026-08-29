import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetCurrentUser,
  useToggleFollow,
  useSendFriendRequest,
  useRespondFriendRequest,
  useUnfriendUser,
  useToggleBlockUser,
  useRecordProfileView,
  type EnhancedProfile,
  getGetEnhancedProfileQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  MapPin,
  Calendar,
  ShieldCheck,
  UserPlus,
  UserCheck,
  UserX,
  MessageSquare,
  MoreHorizontal,
  Ban,
  Flag,
  Check,
  X,
  Users,
} from "lucide-react";

interface ProfileLayoutProps {
  profile: EnhancedProfile;
  children: React.ReactNode;
  activeTab: "posts" | "about" | "friends" | "photos" | "reels" | "videos" | "likes";
  onTabChange: (tab: "posts" | "about" | "friends" | "photos" | "reels" | "videos" | "likes") => void;
}

export function ProfileLayout({ profile, children, activeTab, onTabChange }: ProfileLayoutProps) {
  const { data: session } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [location, navigate] = useLocation();

  const isSelf = profile.friendStatus === "self";
  const isDoll = profile.role === "doll";

  const recordView = useRecordProfileView({
    mutation: { onError: () => {} }, // fire-and-forget
  });

  useEffect(() => {
    if (session?.authenticated && !isSelf) {
      recordView.mutate({ userId: profile.userId });
    }
  }, [profile.userId, session?.authenticated, isSelf]);

  const toggleFollow = useToggleFollow({
    mutation: {
      onSuccess: () => {
        toast({ title: "Follow status updated" });
        queryClient.invalidateQueries({ queryKey: getGetEnhancedProfileQueryKey(profile.userId) });
      },
      onError: () => toast({ title: "Failed to update follow", variant: "destructive" }),
    },
  });

  const sendFriend = useSendFriendRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Buddy request sent" });
        queryClient.invalidateQueries({ queryKey: getGetEnhancedProfileQueryKey(profile.userId) });
      },
      onError: () => toast({ title: "Failed to send request", variant: "destructive" }),
    },
  });

  const respondFriend = useRespondFriendRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Buddy request updated" });
        queryClient.invalidateQueries({ queryKey: getGetEnhancedProfileQueryKey(profile.userId) });
      },
      onError: () => toast({ title: "Failed to update request", variant: "destructive" }),
    },
  });

  const unfriend = useUnfriendUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "Buddy removed" });
        queryClient.invalidateQueries({ queryKey: getGetEnhancedProfileQueryKey(profile.userId) });
      },
      onError: () => toast({ title: "Failed to unfriend", variant: "destructive" }),
    },
  });

  const toggleBlock = useToggleBlockUser({
    mutation: {
      onSuccess: (data) => {
        toast({ title: data.blocked ? "User blocked" : "User unblocked" });
        queryClient.invalidateQueries({ queryKey: getGetEnhancedProfileQueryKey(profile.userId) });
      },
      onError: () => toast({ title: "Failed to update block status", variant: "destructive" }),
    },
  });

  const handleFollow = () => {
    toggleFollow.mutate({ userId: profile.userId });
  };

  const handleMessage = () => {
    navigate("/messages");
  };

  const coverUrl = profile.details?.coverPhotoUrl;
  const location_ = [profile.city, profile.state].filter(Boolean).join(", ");
  const memberSince = profile.memberSince
    ? new Date(profile.memberSince).getFullYear()
    : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Cover Photo */}
      <div className="relative w-full h-64 md:h-80 bg-gradient-to-br from-primary/20 via-background to-secondary/20 border-b border-white/10">
        {coverUrl && (
          <img
            src={coverUrl}
            alt={`${profile.name} cover`}
            className="w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
      </div>

      {/* Profile Header */}
      <div className="container mx-auto px-4">
        <div className="relative -mt-20 md:-mt-24 pb-6 border-b border-white/5">
          <div className="flex flex-col md:flex-row gap-6 items-start md:items-end">
            {/* Profile Photo */}
            <Avatar className="w-36 h-36 md:w-44 md:h-44 border-[6px] border-background bg-card shadow-[0_0_30px_rgba(0,0,0,0.5)]">
              <AvatarImage
                src={profile.profilePhotoUrl || ""}
                className="object-cover"
              />
              <AvatarFallback className="text-5xl font-serif text-primary bg-background">
                {profile.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            {/* Name & Info */}
            <div className="flex-1 pb-2">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-3xl md:text-4xl font-serif font-bold text-white">
                  {profile.name}
                </h1>
                {profile.verified && (
                  <ShieldCheck className="w-6 h-6 text-primary" />
                )}
                {isDoll && (
                  <span className="px-3 py-1 rounded-full bg-primary/20 border border-primary/40 text-xs font-semibold text-primary uppercase tracking-wider">

                    Buddy
                  </span>
                )}
                {!isDoll && (
                  <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold text-white/70 uppercase tracking-wider">
                    Member
                  </span>
                )}
              </div>
              <p className="text-primary font-medium mb-3">
                @{profile.username || `user${profile.userId}`}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                {location_ && (
                  <span className="flex items-center gap-1.5 text-white/80">
                    <MapPin className="w-4 h-4 text-primary" /> {location_}
                  </span>
                )}
                {memberSince && (
                  <span className="flex items-center gap-1.5 text-white/80">
                    <Calendar className="w-4 h-4 text-primary" /> Member since{" "}
                    {memberSince}
                  </span>
                )}
                {(profile.mutualFriendCount ?? 0) > 0 && (
                  <span className="flex items-center gap-1.5 text-white/80">
                    <Users className="w-4 h-4 text-primary" />{" "}
                    {profile.mutualFriendCount} mutual{" "}
                    {profile.mutualFriendCount === 1 ? "Buddy" : "Buddys"}
                  </span>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            {!isSelf && (
              <div className="flex gap-2 shrink-0 pb-2">
                {/* Follow Button */}
                <Button
                  onClick={handleFollow}
                  disabled={toggleFollow.isPending}
                  variant={profile.viewerFollows ? "outline" : "default"}
                  className={`rounded-full px-6 h-11 font-semibold ${
                    profile.viewerFollows
                      ? "border-white/20 text-white hover:bg-white/10"
                      : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_rgba(24,119,242,0.3)]"
                  }`}
                >
                  {profile.viewerFollows ? (
                    <>
                      <UserCheck className="w-4 h-4 mr-2" /> Following
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4 mr-2" /> Follow
                    </>
                  )}
                </Button>

                {/* Friend Button */}
                {profile.friendStatus === "none" && (
                  <Button
                    onClick={() => sendFriend.mutate({ data: { receiverId: profile.userId } })}
                    disabled={sendFriend.isPending}
                    variant="outline"
                    className="rounded-full border-white/20 text-white hover:bg-white/10 px-6 h-11 font-semibold"
                  >
                    <UserPlus className="w-4 h-4 mr-2" /> Add Buddy
                  </Button>
                )}

                {profile.friendStatus === "pending_sent" && (
                  <Button
                    onClick={() =>
                      profile.pendingRequestId &&
                      respondFriend.mutate({
                        id: profile.pendingRequestId,
                        data: { action: "cancel" },
                      })
                    }
                    disabled={respondFriend.isPending}
                    variant="outline"
                    className="rounded-full border-white/20 text-white/60 hover:bg-white/10 px-6 h-11 font-semibold"
                  >
                    Request Sent
                  </Button>
                )}

                {profile.friendStatus === "pending_received" && (
                  <div className="flex gap-2">
                    <Button
                      onClick={() =>
                        profile.pendingRequestId &&
                        respondFriend.mutate({
                          id: profile.pendingRequestId,
                          data: { action: "accept" },
                        })
                      }
                      disabled={respondFriend.isPending}
                      className="rounded-full bg-green-600 hover:bg-green-700 text-white px-6 h-11 font-semibold"
                    >
                      <Check className="w-4 h-4 mr-2" /> Accept
                    </Button>
                    <Button
                      onClick={() =>
                        profile.pendingRequestId &&
                        respondFriend.mutate({
                          id: profile.pendingRequestId,
                          data: { action: "decline" },
                        })
                      }
                      disabled={respondFriend.isPending}
                      variant="outline"
                      className="rounded-full border-white/20 text-white hover:bg-white/10 px-6 h-11"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                {profile.friendStatus === "friends" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="rounded-full border-primary/40 text-primary hover:bg-primary/10 px-6 h-11 font-semibold"
                      >
                        <Check className="w-4 h-4 mr-2" /> Buddys
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-card/95 backdrop-blur-xl border-white/10">
                      <DropdownMenuItem
                        onClick={() => unfriend.mutate({ userId: profile.userId })}
                        className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
                      >
                        <UserX className="w-4 h-4 mr-2" /> Remove Buddy
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Message Button */}
                <Button
                  onClick={handleMessage}
                  variant="outline"
                  className="rounded-full border-white/20 text-white hover:bg-white/10 px-6 h-11 font-semibold"
                >
                  <MessageSquare className="w-4 h-4 mr-2" /> Message
                </Button>

                {/* More Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="rounded-full border-white/20 text-white hover:bg-white/10 h-11 w-11"
                    >
                      <MoreHorizontal className="w-5 h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-card/95 backdrop-blur-xl border-white/10">
                    <DropdownMenuItem
                      onClick={() => toggleBlock.mutate({ userId: profile.userId })}
                      className="cursor-pointer hover:bg-white/5"
                    >
                      <Ban className="w-4 h-4 mr-2" />{" "}
                      {profile.viewerBlocked ? "Unblock" : "Block"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem className="cursor-pointer hover:bg-white/5">
                      <Flag className="w-4 h-4 mr-2" /> Report
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {/* Stats Row */}
          <div className="flex gap-8 mt-6">
            <div className="flex flex-col">
              <span className="text-2xl font-bold text-white tabular-nums leading-none mb-1">
                {profile.postCount || 0}
              </span>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Posts
              </span>
            </div>
            <button
              onClick={() => onTabChange("friends")}
              className="flex flex-col group"
            >
              <span className="text-2xl font-bold text-white tabular-nums leading-none mb-1 group-hover:text-primary transition-colors">
                {profile.friendCount || 0}
              </span>
              <span className="text-xs text-muted-foreground uppercase tracking-wider group-hover:text-primary transition-colors">
                Buddys
              </span>
            </button>
            <div className="flex flex-col">
              <span className="text-2xl font-bold text-white tabular-nums leading-none mb-1">
                {profile.followerCount || 0}
              </span>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Followers
              </span>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex overflow-x-auto gap-1 pt-4 pb-0 hide-scrollbar border-b border-white/5">
          <TabButton
            active={activeTab === "posts"}
            onClick={() => onTabChange("posts")}
          >
            Posts
          </TabButton>
          <TabButton
            active={activeTab === "about"}
            onClick={() => onTabChange("about")}
          >
            About
          </TabButton>
          <TabButton
            active={activeTab === "friends"}
            onClick={() => onTabChange("friends")}
          >
            Buddys
          </TabButton>
          <TabButton
            active={activeTab === "photos"}
            onClick={() => onTabChange("photos")}
          >
            Photos
          </TabButton>
          <TabButton
            active={activeTab === "reels"}
            onClick={() => onTabChange("reels")}
          >
            Sparks
          </TabButton>
          <TabButton
            active={activeTab === "videos"}
            onClick={() => onTabChange("videos")}
          >
            Videos
          </TabButton>
          <TabButton
            active={activeTab === "likes"}
            onClick={() => onTabChange("likes")}
          >
            Likes
          </TabButton>
        </div>
      </div>

      {/* Tab Content */}
      <div className="container mx-auto px-4 py-8">{children}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap px-6 py-3 font-semibold text-sm transition-all border-b-2 ${
        active
          ? "border-primary text-white"
          : "border-transparent text-muted-foreground hover:text-white hover:border-white/20"
      }`}
    >
      {children}
    </button>
  );
}
