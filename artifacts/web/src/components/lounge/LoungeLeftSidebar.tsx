import { Link } from "wouter";
import {
  useGetCurrentUser,
  useGetMyProfile,
  useGetCredits,
  getGetMyProfileQueryKey,
  getGetCreditsQueryKey,
} from "@workspace/api-client-react";
import {
  Home,
  User,
  Users,
  MessageCircle,
  Bell,
  Bookmark,
  Clapperboard,
  Search,
  Coins,
  Crown,
  Flame,
  Star,
  CalendarDays,
  Wind,
  Laugh,
  Sparkles,
  MapPin,
  MessagesSquare,
} from "lucide-react";

type Props = {
  onSelectCategory?: (category: string) => void;
};

const NAV_LINKS = [
  { to: "/feed", label: "The Lounge", icon: Home },
  { to: "/friends", label: "Friends", icon: Users },
  { to: "/messages", label: "Messages", icon: MessageCircle },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/reels", label: "Reels", icon: Clapperboard },
  { to: "/browse", label: "Browse Dolls", icon: Search },
  { to: "/pricing", label: "Pricing / Upgrade", icon: Coins },
];

const COMMUNITY_SHORTCUTS: { label: string; category: string; icon: typeof Flame }[] = [
  { label: "Hookah Setups", category: "setup", icon: Flame },
  { label: "Favorite Flavors", category: "flavor", icon: Star },
  { label: "Lounge Reviews", category: "review", icon: MapPin },
  { label: "Hookah Events", category: "event", icon: CalendarDays },
  { label: "Smoke Talk", category: "discussion", icon: Wind },
  { label: "Hookah Memes", category: "meme", icon: Laugh },
  { label: "Questions", category: "question", icon: MessagesSquare },
  { label: "Local Lounges", category: "lounge", icon: Sparkles },
];

const FOOTER_LINKS = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/#how-it-works", label: "How It Works" },
  { to: "/pricing", label: "Pricing" },
];

export default function LoungeLeftSidebar({ onSelectCategory }: Props) {
  const { data: session } = useGetCurrentUser();
  const authenticated = session?.authenticated && session.user;
  const { data: profile } = useGetMyProfile({
    query: { queryKey: getGetMyProfileQueryKey(), enabled: !!authenticated },
  });
  const { data: credits } = useGetCredits({
    query: {
      queryKey: getGetCreditsQueryKey(),
      enabled: !!authenticated && session?.user?.role === "member",
    },
  });

  const profileHref = authenticated
    ? session!.user!.role === "doll" && session!.user!.dollId
      ? `/dolls/${session!.user!.dollId}`
      : `/members/${session!.user!.id}`
    : "/choose-membership";

  return (
    <aside className="space-y-4">
      {/* Profile shortcut */}
      <div className="rounded-2xl bg-card/30 border border-white/5 backdrop-blur-md p-4">
        {authenticated ? (
          <Link href={profileHref} className="flex items-center gap-3 group">
            {profile?.profilePhotoUrl ? (
              <img
                src={profile.profilePhotoUrl}
                alt=""
                className="h-11 w-11 rounded-full object-cover border border-primary/30"
              />
            ) : (
              <div className="h-11 w-11 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                <User className="h-5 w-5 text-primary" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-white font-medium truncate group-hover:text-primary transition-colors">
                {profile?.name || session!.user!.name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {session!.user!.role === "doll" ? (
                  <span className="inline-flex items-center gap-1 text-primary">
                    <Crown className="h-3 w-3" /> Verified Doll
                  </span>
                ) : (
                  credits?.membershipPlanName || "View profile"
                )}
              </p>
            </div>
          </Link>
        ) : (
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-3">
              Join the community — it's free.
            </p>
            <Link
              href="/choose-membership"
              className="inline-block w-full rounded-full bg-primary text-primary-foreground text-sm font-medium py-2 hover:opacity-90 transition-opacity"
            >
              Create Free Profile
            </Link>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="rounded-2xl bg-card/30 border border-white/5 backdrop-blur-md p-2">
        {(authenticated ? NAV_LINKS : NAV_LINKS.filter((l) => ["/feed", "/reels", "/browse", "/pricing"].includes(l.to))).map(
          ({ to, label, icon: Icon }) => (
            <Link
              key={to + label}
              href={to}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
            >
              <Icon className="h-4 w-4 text-primary/70" />
              {label}
            </Link>
          ),
        )}
      </nav>

      {/* Community shortcuts */}
      <div className="rounded-2xl bg-card/30 border border-white/5 backdrop-blur-md p-2">
        <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-widest text-muted-foreground/70">
          Hookah Community
        </p>
        {COMMUNITY_SHORTCUTS.map(({ label, category, icon: Icon }) =>
          category === "event" ? (
            <Link
              key={category}
              href="/events"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-white hover:bg-white/5 transition-colors text-left"
            >
              <Icon className="h-4 w-4 text-primary/70" />
              {label}
            </Link>
          ) : (
            <button
              key={category}
              onClick={() => onSelectCategory?.(category)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-white hover:bg-white/5 transition-colors text-left"
            >
              <Icon className="h-4 w-4 text-primary/70" />
              {label}
            </button>
          ),
        )}
      </div>

      {/* Footer links */}
      <div className="px-3 flex flex-wrap gap-x-3 gap-y-1">
        {FOOTER_LINKS.map((l) => (
          <Link
            key={l.label}
            href={l.to}
            className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            {l.label}
          </Link>
        ))}
        <span className="text-[11px] text-muted-foreground/40">© HookahDolls</span>
      </div>
    </aside>
  );
}
