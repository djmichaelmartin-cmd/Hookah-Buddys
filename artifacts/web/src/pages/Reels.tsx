import { useState } from "react";
import { Layout } from "@/components/Layout";
import {
  useListReels,
  useCreateReel,
  useGetCurrentUser,
  getListReelsQueryKey,
  type ReelInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ReelCard, ReelPlayer } from "@/components/profile/ReelCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Play, Plus, AlertTriangle } from "lucide-react";
import type { Reel } from "@workspace/api-client-react";

type Category =
  | "hookah_setup"
  | "lounge_night"
  | "flavor_review"
  | "smoke_tricks"
  | "event"
  | "meme"
  | "doll_spotlight"
  | "bro_post"
  | "tutorial"
  | "other";

export default function Reels() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: session } = useGetCurrentUser();

  const [filter, setFilter] = useState<Category | undefined>();
  const [selectedReel, setSelectedReel] = useState<Reel | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: reels, isLoading } = useListReels({ category: filter }, {
    query: { queryKey: getListReelsQueryKey({ category: filter }) },
  });

  const createReel = useCreateReel({
    mutation: {
      onSuccess: () => {
        toast({ title: "Reel uploaded", description: "Your reel is now live!" });
        setUploadOpen(false);
        queryClient.invalidateQueries({ queryKey: getListReelsQueryKey({}) });
      },
      onError: () => toast({ title: "Failed to upload reel", variant: "destructive" }),
    },
  });

  const [videoUrl, setVideoUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState<Category>("other");
  const [hashtags, setHashtags] = useState("");
  const [hookahConfirmed, setHookahConfirmed] = useState(false);

  const handleUpload = () => {
    if (!hookahConfirmed) {
      toast({
        title: "Confirmation required",
        description: "Please confirm this reel is hookah-related.",
        variant: "destructive",
      });
      return;
    }

    const input: ReelInput = {
      videoUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      caption: caption || undefined,
      category,
      hashtags: hashtags
        ? hashtags.split(/[\s,]+/).filter((t) => t.trim().length > 0)
        : [],
      isHookahRelatedConfirmed: true,
    };

    createReel.mutate({ data: input });
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-serif text-white font-bold flex items-center gap-3">
              <Play className="w-8 h-8 text-primary" /> Reels
            </h1>
            <p className="text-muted-foreground mt-2">
              Hookah setups, smoke tricks, lounge vibes, and more.
            </p>
          </div>
          {session?.authenticated && (
            <Button
              onClick={() => setUploadOpen(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-8 font-semibold shadow-[0_0_20px_rgba(212,175,55,0.3)]"
            >
              <Plus className="w-4 h-4 mr-2" /> Upload Reel
            </Button>
          )}
        </div>

        {/* Category Filter */}
        <div className="flex overflow-x-auto gap-2 pb-4 mb-6 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar sticky top-[108px] z-30 bg-background/80 backdrop-blur-xl border-b border-white/5 py-3">
          <button
            onClick={() => setFilter(undefined)}
            className={`whitespace-nowrap px-5 py-2 rounded-full text-sm font-medium transition-all ${
              !filter
                ? "bg-white text-background shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white border border-white/5"
            }`}
          >
            All
          </button>
          {[
            { id: "hookah_setup", label: "Setups" },
            { id: "lounge_night", label: "Lounge Nights" },
            { id: "flavor_review", label: "Flavor Reviews" },
            { id: "smoke_tricks", label: "Smoke Tricks" },
            { id: "event", label: "Events" },
            { id: "tutorial", label: "Tutorials" },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFilter(cat.id as Category)}
              className={`whitespace-nowrap px-5 py-2 rounded-full text-sm font-medium transition-all ${
                filter === cat.id
                  ? "bg-white text-background shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white border border-white/5"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Reels Grid */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
          </div>
        ) : !reels || reels.length === 0 ? (
          <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
            <Play className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-xl font-serif text-white mb-2">No reels yet</h3>
            <p className="text-muted-foreground">
              {session?.authenticated
                ? "Be the first to upload a reel!"
                : "Sign in to start uploading."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {reels.map((reel) => (
              <ReelCard
                key={reel.id}
                reel={reel}
                onClick={() => setSelectedReel(reel)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedReel && (
        <ReelPlayer reel={selectedReel} onClose={() => setSelectedReel(null)} />
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="bg-card border-white/10 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-white flex items-center gap-2">
              <Play className="w-5 h-5 text-primary" /> Upload Reel
            </DialogTitle>
            <DialogDescription>
              Share your hookah content with the community.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="videoUrl">Video URL (or data-URL)</Label>
              <Input
                id="videoUrl"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://... or data:video/..."
                className="bg-background/50 border-white/10 mt-2"
              />
            </div>

            <div>
              <Label htmlFor="thumbnailUrl">Thumbnail URL (optional)</Label>
              <Input
                id="thumbnailUrl"
                value={thumbnailUrl}
                onChange={(e) => setThumbnailUrl(e.target.value)}
                placeholder="https://..."
                className="bg-background/50 border-white/10 mt-2"
              />
            </div>

            <div>
              <Label htmlFor="caption">Caption (optional)</Label>
              <Textarea
                id="caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={3}
                placeholder="Describe your reel..."
                className="bg-background/50 border-white/10 mt-2"
              />
            </div>

            <div>
              <Label htmlFor="category">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as Category)}
              >
                <SelectTrigger
                  id="category"
                  className="bg-background/50 border-white/10 mt-2"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-white/10">
                  <SelectItem value="hookah_setup">Hookah Setup</SelectItem>
                  <SelectItem value="lounge_night">Lounge Night</SelectItem>
                  <SelectItem value="flavor_review">Flavor Review</SelectItem>
                  <SelectItem value="smoke_tricks">Smoke Tricks</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                  <SelectItem value="meme">Meme</SelectItem>
                  <SelectItem value="doll_spotlight">Doll Spotlight</SelectItem>
                  <SelectItem value="bro_post">Member Post</SelectItem>
                  <SelectItem value="tutorial">Tutorial</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="hashtags">Hashtags (space or comma separated)</Label>
              <Input
                id="hashtags"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                placeholder="hookah lounge vibes"
                className="bg-background/50 border-white/10 mt-2"
              />
            </div>

            <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-primary shrink-0" />
              <div>
                <h4 className="font-medium text-primary text-sm mb-1">
                  Hookah Content Required
                </h4>
                <p className="text-xs text-primary/80 mb-3">
                  All reels must be hookah-related to be approved.
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="hookahConfirmed"
                    checked={hookahConfirmed}
                    onChange={(e) => setHookahConfirmed(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-background/50 text-primary"
                  />
                  <Label htmlFor="hookahConfirmed" className="text-sm font-semibold text-white cursor-pointer">
                    I confirm this reel is hookah-related.
                  </Label>
                </div>
              </div>
            </div>

            <Button
              onClick={handleUpload}
              disabled={createReel.isPending || !videoUrl || !hookahConfirmed}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              {createReel.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" /> Upload Reel
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
