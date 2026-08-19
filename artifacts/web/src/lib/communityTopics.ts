import type { FeedPostInputCategory } from "@workspace/api-client-react";
import {
  CalendarDays,
  Flame,
  Laugh,
  MapPin,
  MessagesSquare,
  Sparkles,
  Star,
  Wind,
  type LucideIcon,
} from "lucide-react";

export type CommunityShortcut = {
  label: string;
  category: FeedPostInputCategory;
  icon: LucideIcon;
  href: string;
  description: string;
};

export const COMMUNITY_SHORTCUTS: CommunityShortcut[] = [
  {
    label: "Hookah Setups",
    category: "setup",
    icon: Flame,
    href: "/community/hookah-setups",
    description: "Show off your rig, your pack, and your charcoal setup.",
  },
  {
    label: "Favorite Flavors",
    category: "flavor",
    icon: Star,
    href: "/community/favorite-flavors",
    description: "Share your best mixes and flavor reviews.",
  },
  {
    label: "Lounge Reviews",
    category: "review",
    icon: MapPin,
    href: "/community/lounge-reviews",
    description: "Rate and review lounges you've visited.",
  },
  {
    label: "Hookah Events",
    category: "event",
    icon: CalendarDays,
    href: "/community/hookah-events",
    description: "Everything coming up in the HookahBuddys community.",
  },
  {
    label: "Smoke Talk",
    category: "discussion",
    icon: Wind,
    href: "/community/smoke-talk",
    description: "General discussions about hookah culture.",
  },
  {
    label: "Hookah Memes",
    category: "meme",
    icon: Laugh,
    href: "/community/hookah-memes",
    description: "Laughs and relatable hookah moments.",
  },
  {
    label: "Questions",
    category: "question",
    icon: MessagesSquare,
    href: "/community/questions",
    description: "Need advice? Ask the community.",
  },
  {
    label: "Local Lounges",
    category: "lounge",
    icon: Sparkles,
    href: "/community/local-lounges",
    description: "Find the best hookah spots near you.",
  },
];