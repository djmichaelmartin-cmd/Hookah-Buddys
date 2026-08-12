import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useParams } from "wouter";
import {
  useGetEnhancedProfile,
  useListFeedPosts,
  useListFriends,
  useListUserPhotos,
  useListReels,
  getGetEnhancedProfileQueryKey,
  getListFeedPostsQueryKey,
  getListFriendsQueryKey,
  getListUserPhotosQueryKey,
  getListReelsQueryKey,
} from "@workspace/api-client-react";
import { ProfileLayout } from "@/components/profile/ProfileLayout";
import { AboutSection } from "@/components/profile/AboutSection";
import { FriendCard } from "@/components/profile/FriendCard";
import { PhotoGrid } from "@/components/profile/PhotoGrid";
import { ReelCard, ReelPlayer } from "@/components/profile/ReelCard";
import { FeedPostCard } from "@/components/FeedPostCard";
import { CreatePostForm } from "@/components/CreatePostForm";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, UserX } from "lucide-react";
import type { Reel } from "@workspace/api-client-react";

type Tab = "posts" | "about" | "friends" | "photos" | "reels" | "videos" | "likes";

export default function BroProfile() {
  const { id } = useParams();
  const userId = parseInt(id || "0", 10);
  const [activeTab, setActiveTab] = useState<Tab>("posts");
  const [selectedReel, setSelectedReel] = useState<Reel | null>(null);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useGetEnhancedProfile(userId, {
    query: { enabled: !!userId, queryKey: getGetEnhancedProfileQueryKey(userId) },
  });

  const { data: posts } = useListFeedPosts({ userId }, {
    query: { enabled: activeTab === "posts", queryKey: getListFeedPostsQueryKey({ userId }) },
  });

  const { data: friends } = useListFriends({ userId }, {
    query: { enabled: activeTab === "friends", queryKey: getListFriendsQueryKey({ userId }) },
  });

  const { data: photos } = useListUserPhotos({ userId }, {
    query: { enabled: activeTab === "photos", queryKey: getListUserPhotosQueryKey({ userId }) },
  });

  const { data: reels } = useListReels({ userId }, {
    query: { enabled: activeTab === "reels" || activeTab === "videos", queryKey: getListReelsQueryKey({ userId }) },
  });

  const videoReels = reels?.filter(
    (r) =>
      r.category === "lounge_night" ||
      r.category === "event" ||
      r.category === "tutorial"
  );

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
          <h1 className="font-serif text-3xl text-white mb-4">Member Not Found</h1>
          <p className="text-muted-foreground">
            This profile doesn't exist or was removed.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <ProfileLayout
        profile={profile}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {activeTab === "posts" && (
          <div className="max-w-2xl mx-auto space-y-6">
            {profile.friendStatus === "self" && (
              <CreatePostForm
                onCreated={() =>
                  queryClient.invalidateQueries({ queryKey: getListFeedPostsQueryKey({ userId }) })
                }
              />
            )}
            {!posts || posts.length === 0 ? (
              <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
                <p className="text-muted-foreground">No public posts yet.</p>
              </div>
            ) : (
              posts.map((post) => (
                <FeedPostCard
                  key={post.id}
                  post={post}
                  onLoginPrompt={() => setLoginPromptOpen(true)}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "about" && <AboutSection profile={profile} />}

        {activeTab === "friends" && (
          <div>
            {!profile.canViewFriends ? (
              <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
                <UserX className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <h3 className="text-xl font-serif text-white mb-2">
                  Friends List Hidden
                </h3>
                <p className="text-muted-foreground">
                  This user's friends list is private.
                </p>
              </div>
            ) : !friends || friends.length === 0 ? (
              <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
                <p className="text-muted-foreground">No friends to show.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {friends.map((friend) => (
                  <FriendCard key={friend.id} friend={friend} />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "photos" && (
          <PhotoGrid photos={photos || []} userId={userId} />
        )}

        {activeTab === "reels" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {!reels || reels.length === 0 ? (
              <div className="col-span-full bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
                <p className="text-muted-foreground">No reels yet.</p>
              </div>
            ) : (
              reels.map((reel) => (
                <ReelCard
                  key={reel.id}
                  reel={reel}
                  onClick={() => setSelectedReel(reel)}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "videos" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {!videoReels || videoReels.length === 0 ? (
              <div className="col-span-full bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
                <p className="text-muted-foreground">No videos yet.</p>
              </div>
            ) : (
              videoReels.map((reel) => (
                <ReelCard
                  key={reel.id}
                  reel={reel}
                  onClick={() => setSelectedReel(reel)}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "likes" && (
          <div className="space-y-6">
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <h3 className="text-lg font-serif text-white mb-4">Interests</h3>
              {profile.details?.interests && profile.details.interests.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {profile.details.interests.map((interest, i) => (
                    <span
                      key={i}
                      className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white"
                    >
                      {interest}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No interests shared.</p>
              )}
            </div>

            {(profile.details?.favoriteHookahFlavor ||
              profile.details?.favoriteHookahLounge ||
              profile.details?.favoriteHookahBrand) && (
              <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                <h3 className="text-lg font-serif text-white mb-4">
                  Hookah Favorites
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {profile.details.favoriteHookahFlavor && (
                    <div>
                      <p className="text-sm text-muted-foreground">Flavor</p>
                      <p className="text-white font-medium">
                        {profile.details.favoriteHookahFlavor}
                      </p>
                    </div>
                  )}
                  {profile.details.favoriteHookahLounge && (
                    <div>
                      <p className="text-sm text-muted-foreground">Lounge</p>
                      <p className="text-white font-medium">
                        {profile.details.favoriteHookahLounge}
                      </p>
                    </div>
                  )}
                  {profile.details.favoriteHookahBrand && (
                    <div>
                      <p className="text-sm text-muted-foreground">Brand</p>
                      <p className="text-white font-medium">
                        {profile.details.favoriteHookahBrand}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </ProfileLayout>

      {selectedReel && (
        <ReelPlayer reel={selectedReel} onClose={() => setSelectedReel(null)} />
      )}
    </Layout>
  );
}
