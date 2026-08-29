import { Play, Heart, MessageCircle, Eye, Bookmark } from "lucide-react";
import type { Reel } from "@workspace/api-client-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface SparkCardProps {
  spark: Reel;
  onClick: () => void;
}

export function SparkCard({ spark, onClick }: SparkCardProps) {
  return (
    <button
      onClick={onClick}
      className="group relative aspect-[9/16] rounded-2xl overflow-hidden bg-card border border-white/10 hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_rgba(24,119,242,0.15)] text-left focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
      data-testid={`card-spark-${spark.id}`}
    >
      {spark.thumbnailUrl ? (
        <img
          src={spark.thumbnailUrl}
          alt={spark.caption || "Spark preview"}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-primary/15 via-background to-secondary/15" />
      )}
      
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/0 flex flex-col justify-end p-4 opacity-90 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center justify-center mb-auto mt-6">
          <div className="w-14 h-14 rounded-full bg-black/40 backdrop-blur-md border border-white/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform group-hover:scale-110 shadow-lg">
            <Play className="w-6 h-6 text-white fill-white ml-1" />
          </div>
        </div>
        
        <div className="space-y-3 translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
          <div className="flex items-center gap-2 mb-1">
            <Avatar className="w-6 h-6 border border-white/20 shadow-sm">
              <AvatarImage src={spark.userPhotoUrl || ""} />
              <AvatarFallback className="bg-background text-[10px] text-primary font-bold">
                {spark.userName?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-white font-bold text-sm drop-shadow-md truncate">{spark.userName}</span>
          </div>

          {spark.caption && (
            <p className="text-[14px] text-white/95 line-clamp-2 font-medium leading-snug shadow-black drop-shadow-md">
              {spark.caption}
            </p>
          )}
          <div className="flex items-center gap-3 text-white/80 text-xs font-bold tracking-wide">
            <span className="flex items-center gap-1" data-testid={`spark-likes-${spark.id}`}>
              <Heart className={`w-3.5 h-3.5 ${spark.viewerLiked ? 'fill-primary text-primary' : ''}`} />
              {spark.likeCount || 0}
            </span>
            <span className="flex items-center gap-1" data-testid={`spark-comments-${spark.id}`}>
              <MessageCircle className="w-3.5 h-3.5" />
              {spark.commentCount || 0}
            </span>
            <span className="flex items-center gap-1" data-testid={`spark-views-${spark.id}`}>
              <Eye className="w-3.5 h-3.5" />
              {spark.viewCount || 0}
            </span>
            {spark.viewerSaved && (
              <span className="flex items-center ml-auto" data-testid={`spark-saved-${spark.id}`}>
                <Bookmark className="w-3.5 h-3.5 fill-primary text-primary" />
              </span>
            )}
          </div>
        </div>
      </div>
      
      {spark.category && (
        <span className="absolute top-4 left-4 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md text-[10px] font-bold text-white uppercase tracking-wider border border-white/10 shadow-lg">
          {spark.category.replace(/_/g, " ")}
        </span>
      )}
    </button>
  );
}
