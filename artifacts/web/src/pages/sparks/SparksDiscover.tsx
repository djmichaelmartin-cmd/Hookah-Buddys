import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import {
  useListReels,
  useGetCurrentUser,
  getListReelsQueryKey,
} from "@workspace/api-client-react";
import { SparkCard } from "@/components/sparks/SparkCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Zap, Search, X } from "lucide-react";

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

export default function SparksDiscover() {
  const [, setLocation] = useLocation();
  const { data: session } = useGetCurrentUser();
  const [filter, setFilter] = useState<Category | undefined>();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    document.title = "Sparks | HookahBuddys";
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data: sparks, isLoading } = useListReels(
    { category: filter, search: debouncedSearch || undefined },
    {
      query: { queryKey: getListReelsQueryKey({ category: filter, search: debouncedSearch || undefined }) },
    }
  );

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-4xl font-serif text-white font-bold flex items-center gap-3">
              <Zap className="w-8 h-8 text-primary fill-primary animate-pulse" /> Sparks
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl text-lg">
              Express yourself. Share quick moments, tricks, and lounge nights with the community.
            </p>
          </div>
          {session?.authenticated && (
            <Link href="/sparks/create" className="inline-flex items-center justify-center rounded-full bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-3 font-bold shadow-[0_0_20px_rgba(24,119,242,0.4)] transition-transform active:scale-95 shrink-0" data-testid="link-create-spark">
              <Plus className="w-5 h-5 mr-2" /> Ignite a Spark
            </Link>
          )}
        </div>

        <div className="flex overflow-x-auto gap-2 pb-4 mb-6 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar sticky top-[108px] z-30 bg-background/80 backdrop-blur-xl border-b border-white/5 py-4 items-center">
          <div className="relative shrink-0 w-64 mr-2">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-white/50" />
            </div>
            <Input
              type="text"
              placeholder="Search captions & hashtags..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-10 pr-10 bg-white/5 border-white/10 text-sm rounded-full h-[40px] focus-visible:ring-primary/50 placeholder:text-white/40"
              data-testid="input-search-sparks"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-white/50 hover:text-white transition-colors"
                data-testid="button-clear-search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          
          <button
            onClick={() => setFilter(undefined)}
            data-testid="filter-all"
            className={`whitespace-nowrap px-6 py-2.5 rounded-full text-sm font-bold transition-all ${
              !filter
                ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/5"
            }`}
          >
            All Sparks
          </button>
          {[
            { id: "lounge_night", label: "Lounge Nights" },
            { id: "hookah_setup", label: "Setups" },
            { id: "smoke_tricks", label: "Smoke Tricks" },
            { id: "flavor_review", label: "Reviews" },
            { id: "event", label: "Events" },
            { id: "tutorial", label: "Tutorials" },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFilter(cat.id as Category)}
              data-testid={`filter-${cat.id}`}
              className={`whitespace-nowrap px-6 py-2.5 rounded-full text-sm font-bold transition-all ${
                filter === cat.id
                  ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                  : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/5"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-32" data-testid="loading-sparks">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
          </div>
        ) : !sparks || sparks.length === 0 ? (
          <div className="bg-card/40 backdrop-blur-xl border border-white/5 rounded-3xl p-16 text-center shadow-2xl max-w-2xl mx-auto mt-12" data-testid="empty-sparks">
            <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-primary/20">
              <Zap className="w-10 h-10 text-primary fill-primary/50" />
            </div>
            <h3 className="text-3xl font-serif text-white mb-3">It's quiet here</h3>
            <p className="text-muted-foreground text-lg mb-8">
              {debouncedSearch
                ? `No Sparks found matching "${debouncedSearch}". Try a different search.`
                : session?.authenticated
                ? "Be the first to share a Spark in this category."
                : "Sign in to ignite the first Spark."}
            </p>
            {!debouncedSearch && session?.authenticated && (
              <Link href="/sparks/create">
                <Button size="lg" className="rounded-full px-8 bg-white text-black hover:bg-white/90 font-bold" data-testid="button-create-spark-empty">
                  Create Spark
                </Button>
              </Link>
            )}
            {debouncedSearch && (
              <Button onClick={() => setSearchInput("")} size="lg" className="rounded-full px-8 bg-white/10 text-white hover:bg-white/20 font-bold" data-testid="button-clear-search-empty">
                Clear Search
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
            {sparks.map((spark) => (
              <SparkCard
                key={spark.id}
                spark={spark}
                onClick={() => setLocation(`/sparks/${spark.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
