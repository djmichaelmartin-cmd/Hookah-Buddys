import { useState, useEffect, useRef, type MouseEvent } from "react";
import { Link, useLocation } from "wouter";
import { useGetCurrentUser, useLogout, useGetUnreadNotificationCount, getGetUnreadNotificationCountQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  LogOut,
  User as UserIcon,
  Users,
  Settings,
  Heart,
  Upload,
  MessageSquare,
  Video,
  ShieldCheck,
  DollarSign,
  Search,
  ChevronDown,
  Menu,
  X,
  Bell,
} from "lucide-react";

const NAV_LINKS = [
  { label: "Feed", href: "/feed" },
  { label: "Reels", href: "/reels" },
  { label: "Dolls", href: "/browse" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Pricing", href: "/pricing" },
];

const RESOURCE_LINKS = [
  { label: "Search Lounges", href: "/lounges" },
  { label: "Contact", href: "/contact" },
  { label: "Content Rules", href: "/content-rules" },
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Refund Policy", href: "/refund-policy" },
];

export function Navbar() {
  const [location] = useLocation();
  const { data: session } = useGetCurrentUser();
  const logout = useLogout();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const resourcesCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHome = location === "/";

  const { data: unreadCountObj } = useGetUnreadNotificationCount({
    query: {
      enabled: !!session?.authenticated,
      queryKey: getGetUnreadNotificationCountQueryKey(),
      refetchInterval: 30000 // Poll every 30s
    }
  });
  const unreadCount = unreadCountObj?.count || 0;

  // Open the Resources dropdown on hover; a short grace period on close lets the
  // cursor cross the gap from the trigger into the menu without it snapping shut.
  const openResources = () => {
    if (resourcesCloseTimer.current) clearTimeout(resourcesCloseTimer.current);
    setResourcesOpen(true);
  };
  const scheduleCloseResources = () => {
    if (resourcesCloseTimer.current) clearTimeout(resourcesCloseTimer.current);
    resourcesCloseTimer.current = setTimeout(() => setResourcesOpen(false), 120);
  };

  useEffect(() => {
    return () => {
      if (resourcesCloseTimer.current) clearTimeout(resourcesCloseTimer.current);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  // Smooth-scroll for in-page hash links (e.g. /#how-it-works) when the
  // target already exists on the current page; otherwise let the Link navigate.
  const handleNavClick = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    const i = href.indexOf("#");
    if (i === -1) return;
    const el = document.querySelector(href.slice(i));
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth" });
      setMenuOpen(false);
    }
  };

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/";
      },
    });
  };

  const isAuthed = session?.authenticated && session.user;

  // Transparent over the hero; a faint white (10% opacity) frosted bar on scroll.
  const solid = scrolled || !isHome;
  const navLink = "text-white/85 hover:text-white";
  const outlineBtn =
    "border-white/25 text-white/90 hover:bg-white/10 hover:border-white/40";
  const ctaBtn = "bg-[#1877F2] text-white hover:bg-[#166FE5]";

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-colors duration-300 ${
        solid
          ? "border-b border-[#343A46] bg-[#171A21] backdrop-blur-xl supports-[backdrop-filter]:bg-[#171A21]"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="container relative mx-auto px-4 h-28 flex items-center">
        {/* Left nav group */}
        <nav className="hidden xl:flex items-center gap-7">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              onClick={(e) => handleNavClick(e, l.href)}
              className={`text-sm font-medium ${navLink} transition-colors`}
            >
              {l.label}
            </Link>
          ))}

          <DropdownMenu open={resourcesOpen} onOpenChange={setResourcesOpen} modal={false}>
            <DropdownMenuTrigger
              onMouseEnter={openResources}
              onMouseLeave={scheduleCloseResources}
              className={`group flex items-center gap-1 text-sm font-medium ${navLink} transition-colors outline-none`}
            >
              Resources
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              onMouseEnter={openResources}
              onMouseLeave={scheduleCloseResources}
              onCloseAutoFocus={(e) => e.preventDefault()}
              className="w-52 bg-card/95 backdrop-blur-xl border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.5)] text-foreground"
            >
              {RESOURCE_LINKS.map((r) => (
                <DropdownMenuItem
                  key={r.href}
                  asChild
                  className="cursor-pointer hover:bg-white/5 hover:text-primary"
                >
                  <Link href={r.href} className="w-full">
                    {r.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Link
            href="/signup/doll"
            className={`inline-flex items-center h-9 px-5 rounded-full border text-sm font-medium ${outlineBtn} transition-colors`}
          >
            Become a Doll
          </Link>
        </nav>

        {/* Centered wordmark */}
        <Link
          href="/"
          className="flex items-center xl:absolute xl:left-1/2 xl:-translate-x-1/2"
        >
          <img
            src="/brand/logo.png"
            alt="HookahBuddys.com"
            className="h-16 w-auto -translate-y-[5px] drop-shadow-[0_0_12px_rgba(225,25,49,0.3)]"
          />
        </Link>

        {/* Right action group */}
        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/browse"
            className={`hidden xl:inline-flex items-center gap-2 h-10 pl-4 pr-5 rounded-full border text-sm ${outlineBtn} transition-colors`}
          >
            <Search className="h-4 w-4" />
            Find a Doll
          </Link>

          {session?.authenticated && session.user ? (
            <>
              <Link href="/notifications" className="relative h-10 w-10 flex items-center justify-center rounded-full border border-white/20 text-white/80 hover:bg-white/10 hover:text-white transition-all mr-1">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 h-2.5 w-2.5 bg-[#E11931] rounded-full border-2 border-card" />
                )}
              </Link>
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-10 w-10 rounded-full border border-primary/30 p-0 hover:bg-white/5 transition-all"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarImage src="" alt={session.user.name} />
                    <AvatarFallback className="bg-card text-primary font-serif">
                      {session.user.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-56 bg-card/95 backdrop-blur-xl border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.5)] text-foreground"
                align="end"
                forceMount
              >
                <div className="flex items-center justify-start gap-2 p-2">
                  <div className="flex flex-col space-y-1 leading-none">
                    <p className="font-medium text-primary font-serif">{session.user.name}</p>
                    <p className="w-[200px] truncate text-xs text-muted-foreground">
                      {session.user.email}
                    </p>
                  </div>
                </div>
                <DropdownMenuSeparator className="bg-white/10" />

                <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                  <Link href={session.user.role === "doll" ? `/dolls/${session.user.dollId || session.user.id}` : `/bros/${session.user.id}`} className="flex items-center w-full">
                    <UserIcon className="mr-2 h-4 w-4" />
                    <span>My Profile</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                  <Link href="/profile/edit" className="flex items-center w-full">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Edit Profile</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                  <Link href="/friends" className="flex items-center w-full">
                    <Users className="mr-2 h-4 w-4" />
                    <span>Friends</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                  <Link href="/settings/privacy" className="flex items-center w-full">
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    <span>Privacy Settings</span>
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator className="bg-white/10" />

                {session.user.role === "doll" && (
                  <>
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                      <Link href="/dashboard/doll" className="flex items-center w-full">
                        <DollarSign className="mr-2 h-4 w-4" />
                        <span>Doll Dashboard</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                      <Link href="/upload" className="flex items-center w-full">
                        <Upload className="mr-2 h-4 w-4" />
                        <span>Upload Content</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                      <Link href="/verification" className="flex items-center w-full">
                        <Heart className="mr-2 h-4 w-4" />
                        <span>Verification</span>
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}

                {session.user.role === "member" && (
                  <>
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                      <Link href="/dashboard/member" className="flex items-center w-full">
                        <DollarSign className="mr-2 h-4 w-4" />
                        <span>Credits & Billing</span>
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}

                {session.user.role === "admin" && (
                  <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                    <Link href="/admin" className="flex items-center w-full">
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      <span>Admin Dashboard</span>
                    </Link>
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                  <Link href="/messages" className="flex items-center w-full">
                    <MessageSquare className="mr-2 h-4 w-4" />
                    <span>Messages</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5 hover:text-primary">
                  <Link href="/video-chat" className="flex items-center w-full">
                    <Video className="mr-2 h-4 w-4" />
                    <span>Video Chats</span>
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className={`hidden sm:inline-flex items-center h-10 px-6 rounded-full border text-sm font-medium ${outlineBtn} transition-colors`}
              >
                Log in
              </Link>
              <Link
                href="/choose-membership"
                className={`inline-flex items-center h-10 px-6 rounded-full text-sm font-semibold ${ctaBtn} transition-colors`}
              >
                Create Free Profile
              </Link>
            </>
          )}

          {/* Mobile menu toggle */}
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="primary-mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className={`xl:hidden inline-flex items-center justify-center h-10 w-10 rounded-full border ${outlineBtn} transition-colors`}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown panel */}
      {menuOpen && (
        <div
          id="primary-mobile-menu"
          className="xl:hidden border-t border-white/10 bg-background/95 backdrop-blur-xl"
        >
          <nav className="container mx-auto px-4 py-4 flex flex-col gap-1">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                onClick={(e) => handleNavClick(e, l.href)}
                className={`py-2.5 text-base font-medium ${navLink} transition-colors`}
              >
                {l.label}
              </Link>
            ))}
            <p className="pt-3 pb-1 text-xs uppercase tracking-widest text-muted-foreground">Resources</p>
            {RESOURCE_LINKS.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                onClick={() => setMenuOpen(false)}
                className={`py-2 text-sm ${navLink} transition-colors`}
              >
                {r.label}
              </Link>
            ))}
            <Link
              href="/signup/doll"
              onClick={() => setMenuOpen(false)}
              className={`mt-3 inline-flex items-center justify-center h-11 rounded-full border text-sm font-medium ${outlineBtn} transition-colors`}
            >
              Become a Doll
            </Link>
            {!isAuthed && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className={`inline-flex items-center justify-center h-11 rounded-full border text-sm font-medium ${outlineBtn} transition-colors`}
                >
                  Log in
                </Link>
                <Link
                  href="/choose-membership"
                  onClick={() => setMenuOpen(false)}
                  className={`inline-flex items-center justify-center h-11 rounded-full text-sm font-semibold ${ctaBtn} transition-colors`}
                >
                  Create Free Profile
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
