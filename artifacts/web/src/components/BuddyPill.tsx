import { cn } from "@/lib/utils";
import type { UserBuddyType } from "@workspace/api-client-react";

export type BuddyType = UserBuddyType | undefined;

export function BuddyPill({ buddyType, className }: { buddyType?: BuddyType; className?: string }) {
  const isFemale = buddyType === "female_buddy";
  const isMale = buddyType === "male_buddy";

  const colorClass = isFemale
    ? "bg-doll-rose/20 text-doll-rose border-doll-rose/30"
    : isMale
    ? "bg-primary/20 text-primary border-primary/30"
    : "bg-white/10 text-white/70 border-white/20";

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold tracking-wider border",
        colorClass,
        className
      )}
    >
      Buddy
    </span>
  );
}
