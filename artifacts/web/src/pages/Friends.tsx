import { Layout } from "@/components/Layout";
import {
  useListFriendRequests,
  useRespondFriendRequest,
  useListFriends,
  useListBlockedUsers,
  useToggleBlockUser,
  useGetCurrentUser,
  useListPendingUserTags,
  useReviewUserTag,
  getListFriendRequestsQueryKey,
  getListFriendsQueryKey,
  getListBlockedUsersQueryKey,
  getListPendingUserTagsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { BuddyPill } from "@/components/BuddyPill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link } from "wouter";
import { Users, UserPlus, Ban, Check, X, ShieldCheck, Loader2, Tag } from "lucide-react";

export default function Friends() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: session } = useGetCurrentUser();

  const { data: friendRequests, isLoading: requestsLoading } = useListFriendRequests({
    query: { queryKey: getListFriendRequestsQueryKey() },
  });

  const { data: friends, isLoading: friendsLoading } = useListFriends(
    { userId: session?.user?.id || 0 },
    { query: { enabled: !!session?.user?.id, queryKey: getListFriendsQueryKey({ userId: session?.user?.id || 0 }) } }
  );

  const { data: blockedUsers, isLoading: blockedLoading } = useListBlockedUsers({
    query: { queryKey: getListBlockedUsersQueryKey() },
  });

  const { data: pendingTags } = useListPendingUserTags({
    query: { queryKey: getListPendingUserTagsQueryKey() },
  });

  const respondRequest = useRespondFriendRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Buddy request updated" });
        queryClient.invalidateQueries({ queryKey: getListFriendRequestsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListFriendsQueryKey({ userId: session?.user?.id || 0 }) });
      },
      onError: () => toast({ title: "Failed to update request", variant: "destructive" }),
    },
  });

  const toggleBlock = useToggleBlockUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "Block status updated" });
        queryClient.invalidateQueries({ queryKey: getListBlockedUsersQueryKey() });
      },
      onError: () => toast({ title: "Failed to update block", variant: "destructive" }),
    },
  });

  const reviewTag = useReviewUserTag({
    mutation: {
      onSuccess: () => {
        toast({ title: "Tag reviewed" });
        queryClient.invalidateQueries({ queryKey: getListPendingUserTagsQueryKey() });
      },
      onError: () => toast({ title: "Failed to review tag", variant: "destructive" }),
    },
  });

  const incoming = friendRequests?.incoming || [];
  const outgoing = friendRequests?.outgoing || [];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <h1 className="text-3xl font-serif text-white mb-8 flex items-center gap-3">
          <Users className="w-8 h-8 text-primary" /> Buddys
        </h1>

        <Tabs defaultValue="all" className="w-full">
          <TabsList className="bg-card/50 backdrop-blur-md border border-white/10 mb-6 flex flex-wrap h-auto p-1">
            <TabsTrigger
              value="all"
              className="rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white py-2.5 px-6"
            >
              All Buddys
              <span className="ml-2 bg-primary/20 text-primary text-[10px] px-2 py-0.5 rounded-full">
                {friends?.length || 0}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="requests"
              className="rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white py-2.5 px-6"
            >
              Requests
              {incoming.length > 0 && (
                <span className="ml-2 bg-destructive text-white text-[10px] px-2 py-0.5 rounded-full">
                  {incoming.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="tags"
              className="rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white py-2.5 px-6"
            >
              Pending Tags
              {(pendingTags?.length || 0) > 0 && (
                <span className="ml-2 bg-secondary text-white text-[10px] px-2 py-0.5 rounded-full">
                  {pendingTags?.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="blocked"
              className="rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white py-2.5 px-6"
            >
              Blocked
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-4 mt-0 outline-none">
            {friendsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : !friends || friends.length === 0 ? (
              <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
                <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <h3 className="text-xl font-serif text-white mb-2">No Buddys yet</h3>
                <p className="text-muted-foreground">
                  Start connecting with members to build your network.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {friends.map((friend) => (
                  <div
                    key={friend.id}
                    className="bg-card/40 backdrop-blur-md border border-white/10 rounded-xl p-4"
                  >
                    <div className="flex items-center gap-4">
                      <Link href={`/bros/${friend.id}`}>
                        <Avatar className="w-16 h-16 border-2 border-white/10 hover:border-primary/40 transition-colors cursor-pointer">
                          <AvatarImage
                            src={friend.profilePhotoUrl || ""}
                            className="object-cover"
                          />
                          <AvatarFallback className="bg-background text-primary text-lg font-serif">
                            {friend.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </Link>
                      <div className="flex-1 min-w-0">
                        <Link href={`/bros/${friend.id}`} className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-white font-semibold truncate hover:text-primary transition-colors flex items-center gap-1.5">
                            {friend.name}
                            {friend.verified && (
                              <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                            )}
                          </p>
                          <BuddyPill buddyType={friend.buddyType} className="scale-[0.8] origin-left" />
                        </Link>
                        <p className="text-sm text-muted-foreground truncate">
                          @{friend.username || `user${friend.id}`}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="requests" className="space-y-6 mt-0 outline-none">
            {/* Incoming Requests */}
            <div>
              <h2 className="text-xl font-serif text-white mb-4">
                Incoming Requests ({incoming.length})
              </h2>
              {incoming.length === 0 ? (
                <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-xl p-8 text-center">
                  <p className="text-muted-foreground">No pending requests.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {incoming.map((req) => (
                    <div
                      key={req.id}
                      className="bg-card/40 backdrop-blur-md border border-white/10 rounded-xl p-4 flex items-center gap-4"
                    >
                      <Link href={`/bros/${req.senderId}`}>
                        <Avatar className="w-14 h-14 border-2 border-white/10 hover:border-primary/40 transition-colors cursor-pointer">
                          <AvatarImage src="" />
                          <AvatarFallback className="bg-background text-primary font-serif">
                            U
                          </AvatarFallback>
                        </Avatar>
                      </Link>
                      <div className="flex-1">
                        <p className="text-white font-semibold">User #{req.senderId}</p>
                        <p className="text-xs text-muted-foreground">
                          Sent {new Date(req.createdAt || new Date()).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            respondRequest.mutate({
                              id: req.id,
                              data: { action: "accept" },
                            })
                          }
                          disabled={respondRequest.isPending}
                          className="bg-green-600 hover:bg-green-700 text-white rounded-full px-6"
                        >
                          <Check className="w-4 h-4 mr-1" /> Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            respondRequest.mutate({
                              id: req.id,
                              data: { action: "decline" },
                            })
                          }
                          disabled={respondRequest.isPending}
                          className="border-white/20 text-white hover:bg-white/10 rounded-full"
                        >
                          <X className="w-4 h-4 mr-1" /> Decline
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Outgoing Requests */}
            <div>
              <h2 className="text-xl font-serif text-white mb-4">
                Sent Requests ({outgoing.length})
              </h2>
              {outgoing.length === 0 ? (
                <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-xl p-8 text-center">
                  <p className="text-muted-foreground">No sent requests.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {outgoing.map((req) => (
                    <div
                      key={req.id}
                      className="bg-card/40 backdrop-blur-md border border-white/10 rounded-xl p-4 flex items-center gap-4"
                    >
                      <Link href={`/bros/${req.receiverId}`}>
                        <Avatar className="w-14 h-14 border-2 border-white/10 hover:border-primary/40 transition-colors cursor-pointer">
                          <AvatarImage src="" />
                          <AvatarFallback className="bg-background text-primary font-serif">
                            U
                          </AvatarFallback>
                        </Avatar>
                      </Link>
                      <div className="flex-1">
                        <p className="text-white font-semibold">User #{req.receiverId}</p>
                        <p className="text-xs text-muted-foreground">
                          Sent {new Date(req.createdAt || new Date()).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          respondRequest.mutate({
                            id: req.id,
                            data: { action: "cancel" },
                          })
                        }
                        disabled={respondRequest.isPending}
                        className="text-muted-foreground hover:text-destructive rounded-full"
                      >
                        Cancel
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="blocked" className="mt-0 outline-none">
            {blockedLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : !blockedUsers || blockedUsers.length === 0 ? (
              <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
                <Ban className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <h3 className="text-xl font-serif text-white mb-2">No blocked users</h3>
                <p className="text-muted-foreground">
                  You haven't blocked anyone yet.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {blockedUsers.map((user) => (
                  <div
                    key={user.id}
                    className="bg-card/40 backdrop-blur-md border border-white/10 rounded-xl p-4 flex items-center gap-4"
                  >
                    <Avatar className="w-14 h-14 border-2 border-white/10">
                      <AvatarImage src={user.profilePhotoUrl || ""} />
                      <AvatarFallback className="bg-background text-primary font-serif">
                        {user.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-white font-semibold">{user.name}</p>
                        <BuddyPill buddyType={user.buddyType} className="scale-[0.8] origin-left" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                      @{user.username || `user${user.id}`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleBlock.mutate({ userId: user.id })}
                      disabled={toggleBlock.isPending}
                      className="border-white/20 text-white hover:bg-white/10 rounded-full px-6"
                    >
                      Unblock
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
