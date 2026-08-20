import { Link, useLocation } from "wouter";
import { COMMUNITY_SHORTCUTS } from "@/lib/communityTopics";

export function CommunityTopicsNav({ mobileOnly = false }: { mobileOnly?: boolean }) {
  const [location] = useLocation();

  return (
    <nav
      aria-label="Hookah Groups and topics"
      className={`${mobileOnly ? "lg:hidden " : ""}flex overflow-x-auto pb-4 mb-4 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar gap-2`}
    >
      {COMMUNITY_SHORTCUTS.map(({ label, href, icon: Icon }) => {
        const isActive = location === href ||
          (href === "/community/hookah-events" && location.startsWith("/events")) ||
          (href === "/community/local-lounges" && location.startsWith("/lounges"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
              isActive
                ? "bg-primary text-primary-foreground shadow-[0_0_15px_rgba(24,119,242,0.3)]"
                : "bg-card/60 text-muted-foreground hover:bg-white/10 hover:text-white border border-white/5"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
