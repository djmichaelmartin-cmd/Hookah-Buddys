import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Link } from "wouter";
import { useListFeedPosts } from "@workspace/api-client-react";
import { FeedPostCard } from "@/components/FeedPostCard";
import { CreatePostForm } from "@/components/CreatePostForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Sparkles, Loader2, Frown, Sparkle, X } from "lucide-react";
import LoungeLeftSidebar from "@/components/lounge/LoungeLeftSidebar";
import LoungeRightSidebar from "@/components/lounge/LoungeRightSidebar";

type FilterTab = "trending" | "new" | "nearby" | "dolls" | "bros" | "lounges" | "events";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "new", label: "New" },
  { id: "trending", label: "Trending" },
  { id: "nearby", label: "Nearby" },
  { id: "dolls", label: "Dolls" },
  { id: "bros", label: "Bros" },
  { id: "lounges", label: "Lounges" },
  { id: "events", label: "Events" },
];

export default function Feed() {
  const [filter, setFilter] = useState<FilterTab>("new");
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [hashtag, setHashtag] = useState<string | undefined>(undefined);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);

  const { data: posts, isLoading } = useListFeedPosts({ filter, category, hashtag });

  const selectCategory = (c: string) => {
    setCategory((prev) => (prev === c ? undefined : c));
    setHashtag(undefined);
    setFilter("new");
  };

  const selectHashtag = (tag: string) => {
    setHashtag((prev) => (prev === tag ? undefined : tag));
    setCategory(undefined);
    setFilter("new");
  };

  const handleLoginPrompt = () => {
    setLoginPromptOpen(true);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-[1400px]">
        <div className="mb-8">
          <h1 className="font-serif text-4xl text-white font-bold flex items-center gap-3 drop-shadow-md">
            The Lounge <Sparkles className="h-6 w-6 text-primary" />
          </h1>
          <p className="text-muted-foreground mt-2">Your hookah social feed — post, browse, connect, and discover what's happening in the HookahDolls community.</p>
        </div>

        <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)_320px] lg:gap-6 lg:items-start">
        {/* Left sidebar (desktop) */}
        <div className="hidden lg:block sticky top-[124px] max-h-[calc(100vh-140px)] overflow-y-auto hide-scrollbar">
          <LoungeLeftSidebar onSelectCategory={selectCategory} />
        </div>

        {/* Center feed */}
        <div className="min-w-0">
        <div className="mb-8">
          {/* After posting, jump to the "New" tab so the fresh post is at the top. */}
          <CreatePostForm onCreated={() => setFilter("new")} />
        </div>

        {/* Scrollable Tabs */}
        <div className="flex overflow-x-auto pb-4 mb-6 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar gap-2 sticky top-[108px] z-30 bg-background/80 backdrop-blur-xl border-b border-white/5 py-3">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`whitespace-nowrap px-5 py-2 rounded-full text-sm font-medium transition-all ${
                filter === tab.id
                  ? "bg-white text-background shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white border border-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
          {category && (
            <button
              onClick={() => setCategory(undefined)}
              className="whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium bg-primary/20 text-primary border border-primary/30 flex items-center gap-1.5 hover:bg-primary/30 transition-all"
            >
              {category} <X className="h-3.5 w-3.5" />
            </button>
          )}
          {hashtag && (
            <button
              onClick={() => setHashtag(undefined)}
              className="whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium bg-primary/20 text-primary border border-primary/30 flex items-center gap-1.5 hover:bg-primary/30 transition-all"
            >
              #{hashtag} <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="space-y-6">
          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p>Loading the feed...</p>
            </div>
          ) : posts?.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-center bg-card/20 rounded-2xl border border-white/5 backdrop-blur-md">
              <Frown className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-serif text-xl text-white mb-2">It's quiet in here.</h3>
              <p className="text-muted-foreground max-w-sm">
                No posts found for this filter. Be the first to pack a bowl and start the conversation!
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {posts?.map((post) => (
                <div key={post.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both" style={{ animationDelay: '100ms' }}>
                  <FeedPostCard post={post} onLoginPrompt={handleLoginPrompt} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Discover content below the feed on mobile/tablet */}
        <div className="xl:hidden mt-10">
          <h2 className="font-serif text-2xl text-white mb-4">Discover</h2>
          <LoungeRightSidebar onSelectCategory={selectCategory} onSelectHashtag={selectHashtag} activeHashtag={hashtag} />
        </div>
        </div>

        {/* Right sidebar (desktop) */}
        <div className="hidden xl:block sticky top-[124px] max-h-[calc(100vh-140px)] overflow-y-auto hide-scrollbar">
          <LoungeRightSidebar onSelectCategory={selectCategory} onSelectHashtag={selectHashtag} activeHashtag={hashtag} />
        </div>
        </div>
      </div>

      <Dialog open={loginPromptOpen} onOpenChange={setLoginPromptOpen}>
        <DialogContent className="bg-card border-primary/20 shadow-[0_0_50px_rgba(254,0,1,0.15)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-white flex items-center gap-2">
              <Sparkle className="w-5 h-5 text-primary" /> Join the Lounge
            </DialogTitle>
            <DialogDescription className="text-base">
              You need an account to like, comment, and interact with the community.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-4">
            <Link href="/signup/bro?plan=bronze">
              <Button className="w-full h-12 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
                Create Free Profile
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
