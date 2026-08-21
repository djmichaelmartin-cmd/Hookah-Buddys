import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  useShareFeedPost,
  useShareGroupPost,
  useCopyFeedPostLink,
  useCopyGroupPostLink,
  useListFeedShareRecipients,
  useListFeedShareGroups,
  getListFeedShareRecipientsQueryKey,
  getListFeedShareGroupsQueryKey,
  type SharePostInputDestination,
  type FeedPostAllowedShareDestinationsItem,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Globe,
  Users,
  Lock,
  Link as LinkIcon,
  Send,
  Check,
  Coffee,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getErrorMessage } from "@/lib/error";

const MAX_COMMENT = 500;

// All possible destination options in order
const DESTINATIONS: {
  key: SharePostInputDestination;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "public", label: "Public", icon: Globe },
  { key: "lounge", label: "Lounge", icon: Coffee },
  { key: "friends", label: "Friends", icon: Users },
  { key: "group", label: "Group", icon: Users },
  { key: "private", label: "Private Message", icon: Lock },
];

type SharePostDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceType: "feed" | "group";
  postId: number;
  sourceGroupId?: number;
  privateSourceGroupId?: number;
  viewerCanShare?: boolean;
  viewerCanShareReason?: string | null;
  allowedShareDestinations?: FeedPostAllowedShareDestinationsItem[];
  viewerCanCopyLink?: boolean;
};

export function SharePostDialog({
  open,
  onOpenChange,
  sourceType,
  postId,
  sourceGroupId,
  privateSourceGroupId,
  viewerCanShare = true,
  viewerCanShareReason,
  allowedShareDestinations,
  viewerCanCopyLink = true,
}: SharePostDialogProps) {
  const [destination, setDestination] =
    useState<SharePostInputDestination>("public");
  const [comment, setComment] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<number | undefined>();
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Reset all state when dialog closes
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setDestination("public");
        setComment("");
        setSelectedGroupId(undefined);
        setSelectedUserIds([]);
        setCopied(false);
        setRecipientSearch("");
        setGroupSearch("");
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  const { data: friends, isLoading: loadingFriends } =
    useListFeedShareRecipients(
      { q: recipientSearch || undefined },
      {
        query: {
          enabled:
            open &&
            (destination === "private" || destination === "friends") &&
            viewerCanShare === true,
          queryKey: getListFeedShareRecipientsQueryKey({
            q: recipientSearch || undefined,
          }),
        },
      }
    );

  const { data: groups, isLoading: loadingGroups } = useListFeedShareGroups(
    { q: groupSearch || undefined },
    {
      query: {
        enabled: open && destination === "group" && viewerCanShare === true,
        queryKey: getListFeedShareGroupsQueryKey({
          q: groupSearch || undefined,
        }),
      },
    }
  );

  const effectivePrivateSourceGroupId =
    privateSourceGroupId ??
    (sourceType === "group" &&
    sourceGroupId != null &&
    groups?.some(
      (group) => group.id === sourceGroupId && group.privacy === "private"
    )
      ? sourceGroupId
      : undefined);
  const availableGroups = effectivePrivateSourceGroupId
    ? groups?.filter((group) => group.id === effectivePrivateSourceGroupId)
    : groups;

  const shareFeedPost = useShareFeedPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post shared successfully" });
        handleOpenChange(false);
        queryClient.invalidateQueries();
      },
      onError: (err: unknown) => {
        const msg = getErrorMessage(err);
        const safe =
          msg && msg.length < 200 && !msg.toLowerCase().includes("stack")
            ? msg
            : "Failed to share post. Please try again.";
        toast({ title: safe, variant: "destructive" });
      },
    },
  });

  const shareGroupPost = useShareGroupPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post shared successfully" });
        handleOpenChange(false);
        queryClient.invalidateQueries();
      },
      onError: (err: unknown) => {
        const msg = getErrorMessage(err);
        const safe =
          msg && msg.length < 200 && !msg.toLowerCase().includes("stack")
            ? msg
            : "Failed to share post. Please try again.";
        toast({ title: safe, variant: "destructive" });
      },
    },
  });

  const copyFeedLink = useCopyFeedPostLink();
  const copyGroupLink = useCopyGroupPostLink();

  const isPending = shareFeedPost.isPending || shareGroupPost.isPending;

  // If the current destination becomes disallowed after allowedShareDestinations updates, switch to first allowed one
  useEffect(() => {
    if (!allowedShareDestinations || allowedShareDestinations.length === 0)
      return;
    if (!allowedShareDestinations.includes(destination as any)) {
      const first = DESTINATIONS.find((d) =>
        allowedShareDestinations.includes(d.key as any)
      );
      if (first) setDestination(first.key);
    }
  }, [allowedShareDestinations, destination]);

  useEffect(() => {
    if (
      open &&
      destination === "group" &&
      effectivePrivateSourceGroupId != null
    ) {
      setSelectedGroupId(effectivePrivateSourceGroupId);
    }
  }, [destination, effectivePrivateSourceGroupId, open]);

  const isDestinationAllowed = (key: SharePostInputDestination): boolean => {
    if (!allowedShareDestinations) return true; // if not provided, allow all
    return allowedShareDestinations.includes(key as any);
  };

  const handleShare = () => {
    if (!isDestinationAllowed(destination)) {
      toast({
        title: "This sharing destination is not available",
        variant: "destructive",
      });
      return;
    }
    if (comment.length > MAX_COMMENT) {
      toast({
        title: `Comment too long (max ${MAX_COMMENT} characters)`,
        variant: "destructive",
      });
      return;
    }

    const input = {
      destination,
      sharerComment: comment.trim() || undefined,
      destinationGroupId:
        destination === "group" ? selectedGroupId : undefined,
      recipientUserIds:
        destination === "private" ? selectedUserIds : undefined,
    };

    if (destination === "group" && !selectedGroupId) {
      toast({ title: "Please select a group", variant: "destructive" });
      return;
    }
    if (destination === "private" && selectedUserIds.length === 0) {
      toast({
        title: "Please select at least one recipient",
        variant: "destructive",
      });
      return;
    }

    if (sourceType === "feed") {
      shareFeedPost.mutate({ id: postId, data: input });
    } else {
      if (!sourceGroupId) return;
      shareGroupPost.mutate({ groupId: sourceGroupId, postId, data: input });
    }
  };

  const handleCopyLink = async () => {
    try {
      let url = "";
      if (sourceType === "feed") {
        const res = await copyFeedLink.mutateAsync({ id: postId });
        url = res.canonicalUrl.startsWith("http")
          ? res.canonicalUrl
          : new URL(res.canonicalUrl, window.location.origin).toString();
      } else {
        if (!sourceGroupId) return;
        const res = await copyGroupLink.mutateAsync({
          groupId: sourceGroupId,
          postId,
        });
        url = res.canonicalUrl.startsWith("http")
          ? res.canonicalUrl
          : new URL(res.canonicalUrl, window.location.origin).toString();
      }

      // Always copy to clipboard first — never invoke navigator.share from this action
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Link copied to clipboard" });
    } catch (err) {
      toast({ title: "Failed to copy link", variant: "destructive" });
    }
  };

  const toggleUser = (id: number) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]
    );
  };

  if (!viewerCanShare) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="bg-card border-white/10"
          style={{ width: "calc(100vw - 2rem)", maxWidth: "28rem" }}
        >
          <DialogHeader>
            <DialogTitle className="font-serif text-xl text-white">
              Cannot Share Post
            </DialogTitle>
            <DialogDescription>
              {viewerCanShareReason ||
                "This post is private or sharing has been disabled by the author."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end pt-4">
            <Button onClick={() => handleOpenChange(false)} variant="outline">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="bg-card border-white/10 max-h-[90vh] overflow-y-auto"
        style={{ width: "calc(100vw - 2rem)", maxWidth: "28rem" }}
      >
        <DialogHeader>
          <DialogTitle className="font-serif text-xl text-white">
            Share Post
          </DialogTitle>
          <DialogDescription>
            Choose where to share this post and optionally add a comment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Destination buttons — responsive wrap */}
          <div className="flex flex-wrap gap-2">
            {DESTINATIONS.map(({ key, label, icon: Icon }) => {
              const allowed = isDestinationAllowed(key);
              const isActive = destination === key;
              return (
                <Button
                  key={key}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => allowed && setDestination(key)}
                  disabled={!allowed}
                  title={
                    !allowed
                      ? `${label} sharing is not available for this post`
                      : undefined
                  }
                  className={`${isActive ? "" : "border-white/10"} ${!allowed ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  <Icon className="w-4 h-4 mr-1.5 shrink-0" />
                  <span className="truncate">{label}</span>
                  {!allowed && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      (off)
                    </span>
                  )}
                </Button>
              );
            })}
          </div>

          {/* Comment textarea with character count */}
          <div className="relative">
            <Textarea
              placeholder="Add an optional comment..."
              value={comment}
              onChange={(e) => {
                if (e.target.value.length <= MAX_COMMENT) {
                  setComment(e.target.value);
                }
              }}
              className="bg-background/50 border-white/10 resize-none min-h-[80px] pr-16"
            />
            <span
              className={`absolute bottom-2 right-3 text-xs pointer-events-none tabular-nums ${
                comment.length >= MAX_COMMENT
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {comment.length}/{MAX_COMMENT}
            </span>
          </div>

          {/* Group search + list */}
          {destination === "group" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-white">Select a Group</p>
              <Input
                placeholder="Search groups..."
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
                className="bg-background/50 border-white/10 h-9 text-sm"
                data-testid="group-search-input"
              />
              {loadingGroups ? (
                <div className="text-sm text-muted-foreground animate-pulse">
                  Loading groups...
                </div>
              ) : availableGroups?.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  {groupSearch
                    ? "No groups match your search."
                    : "You are not a member of any groups you can share to."}
                </div>
              ) : (
                <div className="max-h-[200px] overflow-y-auto space-y-1 border border-white/5 p-1 rounded-lg">
                  {availableGroups?.map((group) => (
                    <button
                      key={group.id}
                      onClick={() => setSelectedGroupId(group.id)}
                      className={`w-full flex items-center justify-between p-2 rounded-md transition-colors ${
                        selectedGroupId === group.id
                          ? "bg-primary/20 text-white"
                          : "hover:bg-white/5 text-white/80"
                      }`}
                    >
                      <span className="text-sm truncate">{group.name}</span>
                      {selectedGroupId === group.id && (
                        <Check className="w-4 h-4 text-primary shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recipient search + list */}
          {destination === "private" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-white">
                Select Recipients (up to 10)
              </p>
              <Input
                placeholder="Search friends..."
                value={recipientSearch}
                onChange={(e) => setRecipientSearch(e.target.value)}
                className="bg-background/50 border-white/10 h-9 text-sm"
                data-testid="recipient-search-input"
              />
              {loadingFriends ? (
                <div className="text-sm text-muted-foreground animate-pulse">
                  Loading friends...
                </div>
              ) : friends?.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  {recipientSearch
                    ? "No friends match your search."
                    : "No eligible recipients found."}
                </div>
              ) : (
                <div className="max-h-[200px] overflow-y-auto space-y-1 border border-white/5 p-1 rounded-lg">
                  {friends?.map((user) => {
                    const isSelected = selectedUserIds.includes(user.id);
                    const atLimit =
                      !isSelected && selectedUserIds.length >= 10;
                    return (
                      <button
                        key={user.id}
                        onClick={() => !atLimit && toggleUser(user.id)}
                        disabled={atLimit}
                        className={`w-full flex items-center gap-3 p-2 rounded-md transition-colors ${
                          isSelected ? "bg-primary/20" : "hover:bg-white/5"
                        } ${atLimit ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <Avatar className="h-6 w-6 shrink-0">
                          <AvatarImage src={user.profilePhotoUrl || ""} />
                          <AvatarFallback className="text-[10px]">
                            {user.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-white flex-1 text-left truncate">
                          {user.name}
                        </span>
                        {isSelected && (
                          <Check className="w-4 h-4 text-primary shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Action row — responsive layout */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/5 mt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              disabled={
                !viewerCanCopyLink ||
                copyFeedLink.isPending ||
                copyGroupLink.isPending
              }
              title={
                !viewerCanCopyLink
                  ? "Link copying is not available for this post"
                  : undefined
              }
              className="border-white/10 shrink-0"
              data-testid="copy-link-btn"
            >
              {copied ? (
                <Check className="w-4 h-4 mr-2 text-green-500" />
              ) : (
                <LinkIcon className="w-4 h-4 mr-2" />
              )}
              {copied ? "Copied!" : "Copy Link"}
            </Button>

            <Button
              onClick={handleShare}
              disabled={isPending}
              className="bg-primary text-primary-foreground shrink-0"
              data-testid="share-now-btn"
            >
              <Send className="w-4 h-4 mr-2" />
              Share Now
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
