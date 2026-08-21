import { type SharedPostPreview } from "@workspace/api-client-react";
import { Link } from "wouter";
import { AlertCircle, Globe, Users, Lock, ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function AudienceBadge({ sharedPost }: { sharedPost: SharedPostPreview }) {
  // Derive badge from audience (feed post) or groupPrivacy (group post)
  if (sharedPost.groupPrivacy === "private") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-muted-foreground">
        <Lock className="h-3 w-3" /> Private Group
      </span>
    );
  }
  if (sharedPost.groupPrivacy === "public") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-muted-foreground">
        <Users className="h-3 w-3" /> Public Group
      </span>
    );
  }
  if (sharedPost.audience === "only_me") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-muted-foreground">
        <Lock className="h-3 w-3" /> Only Me
      </span>
    );
  }
  if (sharedPost.audience === "friends" || sharedPost.audience === "followers") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-muted-foreground">
        <Users className="h-3 w-3" /> Friends
      </span>
    );
  }
  if (sharedPost.audience === "public") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-muted-foreground">
        <Globe className="h-3 w-3" /> Public
      </span>
    );
  }
  return null;
}

/**
 * Derive the in-app navigation URL for the shared source.
 * For group posts, if sourcePostId is known we include ?post=<id> to scroll to it.
 * Prefer canonicalUrl-derived paths when the canonical URL is relative (in-app link).
 */
function resolveLink(sharedPost: SharedPostPreview): string {
  const isFeed = sharedPost.sourceType === "feed_post";

  // If we have a canonical URL that is a relative in-app path, use it directly
  if (sharedPost.canonicalUrl) {
    try {
      // Absolute URL — extract the path+search
      const u = new URL(sharedPost.canonicalUrl);
      return u.pathname + u.search + u.hash;
    } catch {
      // Already relative
      return sharedPost.canonicalUrl;
    }
  }

  if (isFeed) {
    return `/posts/${sharedPost.sourcePostId}`;
  }

  // Group post — include ?post=<id> for exact navigation
  const base = `/groups/${sharedPost.sourceGroupId}`;
  return sharedPost.sourcePostId ? `${base}?post=${sharedPost.sourcePostId}` : base;
}

export function SharedPostPreviewCard({
  sharedPost,
}: {
  sharedPost: SharedPostPreview;
}) {
  if (!sharedPost.available) {
    return (
      <div className="border border-white/5 rounded-xl p-4 bg-card/30 flex items-center gap-3 text-muted-foreground mt-3">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <p className="text-sm">Original post is unavailable or private.</p>
      </div>
    );
  }

  const linkUrl = resolveLink(sharedPost);

  return (
    <Link
      href={linkUrl}
      className="block mt-3 border border-white/10 rounded-xl bg-background/40 hover:bg-background/60 transition-colors overflow-hidden group"
    >
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Avatar className="h-6 w-6 border border-white/10 shrink-0">
            <AvatarImage src={sharedPost.authorPhotoUrl || ""} />
            <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
              {sharedPost.authorName?.charAt(0) || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">
              {sharedPost.authorName}
            </span>
            {sharedPost.groupName && (
              <>
                <span className="text-xs text-muted-foreground">&bull;</span>
                <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                  {sharedPost.groupName}
                </span>
              </>
            )}
            <AudienceBadge sharedPost={sharedPost} />
          </div>
          <ExternalLink className="h-4 w-4 text-white/30 group-hover:text-white/70 transition-colors shrink-0" />
        </div>

        {sharedPost.text && (
          <div className="text-sm text-white/90 whitespace-pre-wrap break-words line-clamp-3 mb-3">
            {sharedPost.text}
          </div>
        )}

        {sharedPost.mediaUrl && (
          <div className="rounded-lg overflow-hidden border border-white/5 bg-black/50">
            {sharedPost.mediaType === "video" ? (
              <video
                src={sharedPost.mediaUrl}
                poster={sharedPost.posterUrl || undefined}
                className="w-full max-h-[300px] object-cover"
                muted
                playsInline
              />
            ) : (
              <img
                src={sharedPost.mediaUrl}
                alt=""
                className="w-full max-h-[300px] object-cover"
                loading="lazy"
              />
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
