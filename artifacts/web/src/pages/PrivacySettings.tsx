import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import {
  useGetPrivacySettings,
  useUpdatePrivacySettings,
  getGetPrivacySettingsQueryKey,
  type PrivacySettingsInput,
  type PrivacySettingsInputDefaultPostAudience,
  type PrivacySettingsInputShowFriendsList,
  type PrivacySettingsInputShowFollowersList,
  type PrivacySettingsInputAllowFriendRequestsFrom,
  type PrivacySettingsInputAllowMessagesFrom,
  type PrivacySettingsInputAllowTagging,
  type PrivacySettingsInputAllowSearchByEmail,
  type PrivacySettingsInputAllowSearchByPhone,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, Shield } from "lucide-react";

export default function PrivacySettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading } = useGetPrivacySettings({
    query: { queryKey: getGetPrivacySettingsQueryKey() },
  });

  const [defaultPostAudience, setDefaultPostAudience] = useState<PrivacySettingsInputDefaultPostAudience>("public");
  const [showFriendsList, setShowFriendsList] = useState<PrivacySettingsInputShowFriendsList>("public");
  const [showFollowersList, setShowFollowersList] = useState<PrivacySettingsInputShowFollowersList>("public");
  const [allowFriendRequestsFrom, setAllowFriendRequestsFrom] = useState<PrivacySettingsInputAllowFriendRequestsFrom>("everyone");
  const [allowMessagesFrom, setAllowMessagesFrom] = useState<PrivacySettingsInputAllowMessagesFrom>("everyone");
  const [allowTagging, setAllowTagging] = useState<PrivacySettingsInputAllowTagging>("everyone");
  const [requireTagReview, setRequireTagReview] = useState<boolean>(true);
  const [allowSearchByEmail, setAllowSearchByEmail] = useState<PrivacySettingsInputAllowSearchByEmail>("everyone");
  const [allowSearchByPhone, setAllowSearchByPhone] = useState<PrivacySettingsInputAllowSearchByPhone>("everyone");
  const [allowExternalSearchIndexing, setAllowExternalSearchIndexing] = useState<boolean>(true);

  useEffect(() => {
    if (settings) {
      if (settings.defaultPostAudience) setDefaultPostAudience(settings.defaultPostAudience);
      if (settings.showFriendsList) setShowFriendsList(settings.showFriendsList);
      if (settings.showFollowersList) setShowFollowersList(settings.showFollowersList);
      if (settings.allowFriendRequestsFrom) setAllowFriendRequestsFrom(settings.allowFriendRequestsFrom);
      if (settings.allowMessagesFrom) setAllowMessagesFrom(settings.allowMessagesFrom);
      if (settings.allowTagging) setAllowTagging(settings.allowTagging);
      if (settings.requireTagReview !== undefined) setRequireTagReview(settings.requireTagReview);
      if (settings.allowSearchByEmail) setAllowSearchByEmail(settings.allowSearchByEmail);
      if (settings.allowSearchByPhone) setAllowSearchByPhone(settings.allowSearchByPhone);
      if (settings.allowExternalSearchIndexing !== undefined) setAllowExternalSearchIndexing(settings.allowExternalSearchIndexing);
    }
  }, [settings]);

  const updateSettings = useUpdatePrivacySettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "Privacy settings saved" });
        queryClient.invalidateQueries({ queryKey: getGetPrivacySettingsQueryKey() });
      },
      onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
    },
  });

  const handleSave = () => {
    const input: PrivacySettingsInput = {
      defaultPostAudience,
      showFriendsList,
      showFollowersList,
      allowFriendRequestsFrom,
      allowMessagesFrom,
      allowTagging,
      requireTagReview,
      allowSearchByEmail,
      allowSearchByPhone,
      allowExternalSearchIndexing,
    };

    updateSettings.mutate({ data: input });
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

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-serif text-white flex items-center gap-3">
              <Shield className="w-8 h-8 text-primary" /> Privacy Settings
            </h1>
            <p className="text-muted-foreground mt-2">
              Control who can see your content and interact with you.
            </p>
          </div>
          <Button
            onClick={handleSave}
            disabled={updateSettings.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-8 font-semibold shadow-[0_0_20px_rgba(212,175,55,0.3)]"
          >
            {updateSettings.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" /> Save Changes
              </>
            )}
          </Button>
        </div>

        <div className="space-y-6">
          {/* Posts & Content */}
          <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
            <h2 className="text-xl font-serif text-white mb-6">Posts & Content</h2>
            <div className="space-y-6">
              <div>
                <Label htmlFor="defaultPostAudience">
                  Who can see your posts by default
                </Label>
                <p className="text-sm text-muted-foreground mb-2">
                  You can change this for individual posts when you create them.
                </p>
                <Select value={defaultPostAudience} onValueChange={(v) => setDefaultPostAudience(v as PrivacySettingsInputDefaultPostAudience)}>
                  <SelectTrigger
                    id="defaultPostAudience"
                    className="bg-background/50 border-white/10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="friends">Friends</SelectItem>
                    <SelectItem value="followers">Followers</SelectItem>
                    <SelectItem value="only_me">Only me</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Friends & Followers */}
          <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
            <h2 className="text-xl font-serif text-white mb-6">
              Friends & Followers
            </h2>
            <div className="space-y-6">
              <div>
                <Label htmlFor="showFriendsList">Who can see your friends list</Label>
                <Select
                  value={showFriendsList}
                  onValueChange={(v) => setShowFriendsList(v as PrivacySettingsInputShowFriendsList)}
                >
                  <SelectTrigger
                    id="showFriendsList"
                    className="bg-background/50 border-white/10 mt-2"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="friends">Friends</SelectItem>
                    <SelectItem value="only_me">Only me</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="showFollowersList">Who can see your followers list</Label>
                <Select
                  value={showFollowersList}
                  onValueChange={(v) => setShowFollowersList(v as PrivacySettingsInputShowFollowersList)}
                >
                  <SelectTrigger
                    id="showFollowersList"
                    className="bg-background/50 border-white/10 mt-2"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="friends">Friends</SelectItem>
                    <SelectItem value="only_me">Only me</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="allowFriendRequestsFrom">
                  Who can send you friend requests
                </Label>
                <Select
                  value={allowFriendRequestsFrom}
                  onValueChange={(v) => setAllowFriendRequestsFrom(v as PrivacySettingsInputAllowFriendRequestsFrom)}
                >
                  <SelectTrigger
                    id="allowFriendRequestsFrom"
                    className="bg-background/50 border-white/10 mt-2"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="everyone">Everyone</SelectItem>
                    <SelectItem value="friends_of_friends">Friends of friends</SelectItem>
                    <SelectItem value="no_one">No one</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Messages & Tags */}
          <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
            <h2 className="text-xl font-serif text-white mb-6">
              Messages & Tagging
            </h2>
            <div className="space-y-6">
              <div>
                <Label htmlFor="allowMessagesFrom">Who can message you</Label>
                <Select value={allowMessagesFrom} onValueChange={(v) => setAllowMessagesFrom(v as PrivacySettingsInputAllowMessagesFrom)}>
                  <SelectTrigger
                    id="allowMessagesFrom"
                    className="bg-background/50 border-white/10 mt-2"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="everyone">Everyone</SelectItem>
                    <SelectItem value="friends">Friends</SelectItem>
                    <SelectItem value="no_one">No one</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="allowTagging">Who can tag you in posts and photos</Label>
                <Select value={allowTagging} onValueChange={(v) => setAllowTagging(v as PrivacySettingsInputAllowTagging)}>
                  <SelectTrigger
                    id="allowTagging"
                    className="bg-background/50 border-white/10 mt-2"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="everyone">Everyone</SelectItem>
                    <SelectItem value="friends">Friends</SelectItem>
                    <SelectItem value="no_one">No one</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="requireTagReview"
                  checked={requireTagReview}
                  onChange={(e) => setRequireTagReview(e.target.checked)}
                  className="w-4 h-4 rounded border-white/20 bg-background/50 text-primary"
                />
                <Label htmlFor="requireTagReview" className="cursor-pointer">
                  Review tags before they appear on your profile
                </Label>
              </div>
            </div>
          </div>

          {/* Search & Discoverability */}
          <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-2xl p-6">
            <h2 className="text-xl font-serif text-white mb-6">
              Search & Discoverability
            </h2>
            <div className="space-y-6">
              <div>
                <Label htmlFor="allowSearchByEmail">Find you by email</Label>
                <Select value={allowSearchByEmail} onValueChange={(v) => setAllowSearchByEmail(v as PrivacySettingsInputAllowSearchByEmail)}>
                  <SelectTrigger
                    id="allowSearchByEmail"
                    className="bg-background/50 border-white/10 mt-2"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="everyone">Everyone</SelectItem>
                    <SelectItem value="friends">Friends</SelectItem>
                    <SelectItem value="no_one">No one</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="allowSearchByPhone">Find you by phone</Label>
                <Select value={allowSearchByPhone} onValueChange={(v) => setAllowSearchByPhone(v as PrivacySettingsInputAllowSearchByPhone)}>
                  <SelectTrigger
                    id="allowSearchByPhone"
                    className="bg-background/50 border-white/10 mt-2"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="everyone">Everyone</SelectItem>
                    <SelectItem value="friends">Friends</SelectItem>
                    <SelectItem value="no_one">No one</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="allowExternalSearchIndexing"
                  checked={allowExternalSearchIndexing}
                  onChange={(e) => setAllowExternalSearchIndexing(e.target.checked)}
                  className="w-4 h-4 rounded border-white/20 bg-background/50 text-primary"
                />
                <Label htmlFor="allowExternalSearchIndexing" className="cursor-pointer">
                  Allow search engines outside of HookahDolls to link to your profile
                </Label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
