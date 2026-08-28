import { Link, useLocation } from "wouter";
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
  Clapperboard,
  Search,
  Coins,
  Crown,
  CalendarDays,
} from "lucide-react";
import { COMMUNITY_SHORTCUTS } from "@/lib/communityTopics";

const NAV_LINKS = [
  { to: "/feed", label: "The Lounge", icon: Home },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/meetups", label: "Meetups", icon: CalendarDays },
  { to: "/friends", label: "Buddys", icon: Users },
  { to: "/messages", label: "Messages", icon: MessageCircle },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/reels", label: "Reels", icon: Clapperboard },
  { to: "/browse", label: "Browse Buddys", icon: Search },
  { to: "/pricing", label: "Pricing / Upgrade", icon: Coins },
];

const FOOTER_LINKS = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/#how-it-works", label: "How It Works" },
  { to: "/pricing", label: "Pricing" },
];

export default function LoungeLeftSidebar() {
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

  const [location] = useLocation();

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
                    <Crown className="h-3 w-3" />  Verified Buddy
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
        {(authenticated ? NAV_LINKS : NAV_LINKS.filter((l) => ["/feed", "/reels", "/groups", "/meetups", "/browse", "/pricing"].includes(l.to))).map(
          ({ to, label, icon: Icon }) => {
            const isActive = location === to || (to !== "/" && location.startsWith(to) && to !== "/feed");
            return (
              <Link
                key={to + label}
                href={to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  isActive
                    ? "bg-white/10 text-white font-medium"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? "text-white" : "text-primary/70"}`} />
                {label}
              </Link>
            );
          }
        )}
      </nav>

      {/* Group and topic shortcuts */}
      <div className="rounded-2xl bg-card/30 border border-white/5 backdrop-blur-md p-2">
        <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-widest text-muted-foreground/70">
          Groups & Topics
        </p>
        {COMMUNITY_SHORTCUTS.map(({ label, href, icon: Icon }) => {
          const isActive = location === href ||
            (href === "/community/hookah-events" && location.startsWith("/events")) ||
            (href === "/community/local-lounges" && location.startsWith("/lounges"));
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors text-left ${
                isActive
                  ? "bg-primary/20 text-white font-medium"
                  : "text-muted-foreground hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-primary" : "text-primary/70"}`} />
              {label}
            </Link>
          );
        })}
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
        <span className="text-[11px] text-muted-foreground/40">© HookahBuddys</span>
      </div>
    </aside>
  );
}
