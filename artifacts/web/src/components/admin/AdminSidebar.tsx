import { useState, type ComponentType } from "react";
import {
  BadgeCheck,
  Ban,
  Building2,
  CalendarDays,
  ClipboardList,
  Coins,
  CreditCard,
  Download,
  FileText,
  Flame,
  Home,
  Image,
  LogOut,
  Menu,
  MessageCircle,
  Share2,
  ShieldCheck,
  UserCircle,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type AdminSection = {
  value: string;
  label: string;
  path: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

export const ADMIN_SECTIONS: AdminSection[] = [
  { value: "applications", label: "Applications", path: "/admin/applications", description: "Review and manage pending applications.", icon: ClipboardList },
  { value: "media", label: "Media Moderation", path: "/admin/media-moderation", description: "Review pending and reported media.", icon: ShieldCheck },
  { value: "verifications", label: "Verifications", path: "/admin/verifications", description: "Review Creator and business verification submissions.", icon: BadgeCheck },
  { value: "feed", label: "Lounge", path: "/admin/lounge", description: "Manage Lounge posts, reports, and activity.", icon: MessageCircle },
  { value: "shares", label: "Shares", path: "/admin/shares", description: "Review sharing activity and sharing restrictions.", icon: Share2 },
  { value: "photos", label: "Photos", path: "/admin/photos", description: "Moderate uploaded photos across the platform.", icon: Image },
  { value: "reels", label: "Sparks", path: "/admin/sparks", description: "Moderate short-form Spark videos.", icon: Flame },
  { value: "blocks", label: "Blocks", path: "/admin/blocks", description: "Review user blocks and safety activity.", icon: Ban },
  { value: "users", label: "Users", path: "/admin/users", description: "Manage user accounts, roles, and access.", icon: Users },
  { value: "profiles", label: "Profiles", path: "/admin/profiles", description: "Review and manage member profile details.", icon: UserCircle },
  { value: "credits", label: "Credits", path: "/admin/credits", description: "Manage credit packages, balances, and transactions.", icon: Coins },
  { value: "plans", label: "Plans", path: "/admin/plans", description: "Manage membership plan names and benefits.", icon: CreditCard },
  { value: "events", label: "Events", path: "/admin/events", description: "Create and manage platform events.", icon: CalendarDays },
  { value: "leads", label: "Leads", path: "/admin/leads", description: "Review and collect prospective business leads.", icon: UserPlus },
  { value: "businesses", label: "Businesses", path: "/admin/businesses", description: "Manage business pages and moderation.", icon: Building2 },
  { value: "groups", label: "Groups", path: "/admin/groups", description: "Manage Groups and community activity.", icon: UsersRound },
  { value: "custom-requests", label: "Custom Requests", path: "/admin/custom-requests", description: "Review custom Creator content requests.", icon: FileText },
  { value: "investor-deck", label: "Investor Deck", path: "/admin/investor-deck", description: "Download the investor pitch deck.", icon: Download },
];

const PATH_TO_SECTION = new Map(ADMIN_SECTIONS.map((section) => [section.path, section.value]));

export function getAdminSectionFromPath(path: string): string {
  if (path === "/admin/meetups") return "events";
  return PATH_TO_SECTION.get(path) ?? "applications";
}

function SidebarContents({
  activeSection,
  counts,
  onNavigate,
  onLogout,
}: {
  activeSection: string;
  counts: Partial<Record<string, number>>;
  onNavigate: (section: AdminSection) => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#171A21]">
      <div className="border-b border-[#343A46] px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8E95A3]">HookahBuddys</p>
        <h2 className="mt-1 text-xl font-semibold text-[#F5F7FA]">Admin Dashboard</h2>
      </div>

      <nav aria-label="Admin sections" className="min-h-0 flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {ADMIN_SECTIONS.map((section) => {
            const Icon = section.icon;
            const active = section.value === activeSection;
            const count = counts[section.value];
            return (
              <li key={section.value}>
                <button
                  type="button"
                  onClick={() => onNavigate(section)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-10 w-full items-center gap-3 rounded-r-lg border-l-2 px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]",
                    active
                      ? "border-[#1877F2] bg-[#262B35] font-medium text-white"
                      : "border-transparent text-[#C7CBD3] hover:bg-[#262B35] hover:text-white",
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", active ? "text-[#1877F2]" : "text-[#8E95A3]")} />
                  <span className="min-w-0 flex-1 truncate">{section.label}</span>
                  {typeof count === "number" && count > 0 && (
                    <span className="min-w-6 rounded-full bg-[#1877F2]/20 px-1.5 py-0.5 text-center text-[11px] font-semibold text-[#7DB5FF]">
                      {count}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="space-y-1 border-t border-[#343A46] p-3">
        <a
          href="/"
          className="flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#C7CBD3] transition-colors hover:bg-[#262B35] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]"
        >
          <Home className="h-4 w-4" />
          Back to Site
        </a>
        <button
          type="button"
          onClick={onLogout}
          className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-[#C7CBD3] transition-colors hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </div>
  );
}

export function AdminSidebar({
  activeSection,
  counts,
  onNavigate,
  onLogout,
}: {
  activeSection: string;
  counts: Partial<Record<string, number>>;
  onNavigate: (section: AdminSection) => void;
  onLogout: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const handleMobileNavigate = (section: AdminSection) => {
    setMobileOpen(false);
    window.setTimeout(() => onNavigate(section), 0);
  };

  return (
    <>
      <aside className="sticky top-24 hidden h-[calc(100vh-7rem)] overflow-hidden rounded-xl border border-[#343A46] bg-[#171A21] lg:block">
        <SidebarContents activeSection={activeSection} counts={counts} onNavigate={onNavigate} onLogout={onLogout} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            className="border-[#343A46] bg-[#171A21] text-white hover:bg-[#262B35] lg:hidden"
            aria-label="Open admin navigation"
          >
            <Menu className="mr-2 h-4 w-4" />
            Admin Menu
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[min(88vw,300px)] border-[#343A46] bg-[#171A21] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Admin navigation</SheetTitle>
            <SheetDescription>Choose a HookahBuddys administration section.</SheetDescription>
          </SheetHeader>
          <SidebarContents activeSection={activeSection} counts={counts} onNavigate={handleMobileNavigate} onLogout={onLogout} />
        </SheetContent>
      </Sheet>
    </>
  );
}