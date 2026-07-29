import { Link } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShieldCheck } from "lucide-react";
import type { FollowUser } from "@workspace/api-client-react";

interface FriendCardProps {
  friend: FollowUser;
}

export function FriendCard({ friend }: FriendCardProps) {
  const location = [friend.city, friend.state].filter(Boolean).join(", ");

  return (
    <Link
      href={`/bros/${friend.id}`}
      className="group block bg-card/40 backdrop-blur-md border border-white/10 rounded-xl p-4 hover:bg-card/60 hover:border-primary/30 transition-all"
    >
      <div className="flex items-center gap-4">
        <Avatar className="w-16 h-16 border-2 border-white/10 group-hover:border-primary/40 transition-colors">
          <AvatarImage
            src={friend.profilePhotoUrl || ""}
            className="object-cover"
          />
          <AvatarFallback className="bg-background text-primary text-lg font-serif">
            {friend.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold truncate group-hover:text-primary transition-colors flex items-center gap-1.5">
            {friend.name}
            {friend.verified && <ShieldCheck className="w-4 h-4 text-primary shrink-0" />}
          </p>
          <p className="text-sm text-muted-foreground truncate">
            @{friend.username || `user${friend.id}`}
          </p>
          {location && (
            <p className="text-xs text-muted-foreground truncate">{location}</p>
          )}
        </div>
      </div>
    </Link>
  );
}
