import { Layout } from "@/components/Layout";
import { useRoute, useLocation } from "wouter";
import { useGetFeedPost, getGetFeedPostQueryKey } from "@workspace/api-client-react";
import { FeedPostCard } from "@/components/FeedPostCard";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PostDetail() {
  const [, params] = useRoute("/posts/:id");
  const [, setLocation] = useLocation();
  const id = parseInt(params?.id || "0", 10);

  const { data: post, isLoading, error } = useGetFeedPost(id, {
    query: {
      enabled: !!id,
      queryKey: getGetFeedPostQueryKey(id),
    }
  });

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-2xl min-h-[calc(100vh-200px)]">
        <Button 
          variant="ghost" 
          className="mb-6 -ml-4 text-muted-foreground hover:text-white"
          onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/feed")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>

        {isLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-64 bg-card/50 rounded-2xl border border-white/5" />
          </div>
        ) : error || !post ? (
          <div className="border border-white/5 rounded-2xl bg-card p-12 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
            <h2 className="text-xl font-serif text-white mb-2">Original post is unavailable or private</h2>
            <p className="text-muted-foreground text-sm mb-6">
              The post you are looking for has been deleted or its privacy settings do not allow you to view it.
            </p>
            <Button onClick={() => setLocation("/feed")}>Go to the Lounge</Button>
          </div>
        ) : (
          <div className="space-y-6">
            <FeedPostCard post={post} onLoginPrompt={() => setLocation("/login")} />
          </div>
        )}
      </div>
    </Layout>
  );
}
