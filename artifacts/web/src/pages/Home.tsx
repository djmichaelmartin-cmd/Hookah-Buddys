import { Layout } from "@/components/Layout";
import { Link } from "wouter";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type TransitionEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { useListFeaturedDolls } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import {
  Star,
  ShieldCheck,
  Video,
  MessageSquare,
  Lock,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  ArrowDown,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;
const HERO_IMAGES = [1, 2, 3, 4, 5].map((i) => `${BASE}lounge/lounge${i}.png`);
const N = HERO_IMAGES.length;
// Number of vertical panels that "open up" in sequence during a hero transition.
const PANELS = 6;

export default function Home() {
  const { data: featuredDolls } = useListFeaturedDolls();
  const dolls = (featuredDolls ?? []).filter((d) => d.profilePhotoUrl);

  // ---- Hero reveal carousel (atmospheric lounge imagery) ----
  // The next image is "opened up" over the current one with an animated
  // clip-path wipe, mirroring Patreon's hero transition.
  const [current, setCurrent] = useState(0);
  const [incoming, setIncoming] = useState<{ index: number; dir: 1 | -1 } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [reduced, setReduced] = useState(false);
  // Cursor-tracking preview bubble over the hero.
  const [pointer, setPointer] = useState<{ x: number; y: number; dir: 1 | -1 } | null>(null);
  const heroRef = useRef<HTMLElement>(null);
  const pointerRaf = useRef<number | null>(null);
  const moving = useRef(false);
  const currentRef = useRef(0);
  const incomingRef = useRef(incoming);
  const reducedRef = useRef(false);
  const fallbackTimer = useRef<number | null>(null);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  useEffect(() => {
    incomingRef.current = incoming;
  }, [incoming]);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  // Track the user's reduced-motion preference (and react to changes).
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  // Promote the incoming image to current and release the transition lock.
  const commit = useCallback(() => {
    const inc = incomingRef.current;
    if (!inc) return;
    setCurrent(inc.index);
    setIncoming(null);
    setRevealed(false);
    moving.current = false;
    if (fallbackTimer.current !== null) {
      clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
    }
  }, []);

  const start = useCallback(
    (index: number, dir: 1 | -1) => {
      if (moving.current || index === currentRef.current) return;
      // Reduced motion: swap instantly, no animated wipe.
      if (reducedRef.current) {
        setCurrent(index);
        return;
      }
      moving.current = true;
      setIncoming({ index, dir });
      setRevealed(false);
    },
    [],
  );

  const go = useCallback(
    (dir: 1 | -1) => start((currentRef.current + dir + N) % N, dir),
    [start],
  );

  const goTo = useCallback(
    (index: number) => start(index, index > currentRef.current ? 1 : -1),
    [start],
  );

  // Once the incoming layer has mounted in its hidden state, flip to revealed
  // on the next frame so the clip-path animates.
  useEffect(() => {
    if (!incoming || revealed) return;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setRevealed(true)),
    );
    return () => cancelAnimationFrame(id);
  }, [incoming, revealed]);

  // Safety net: if the transitionend event is missed (browser quirks), force
  // the commit after the wipe duration so navigation can never deadlock.
  useEffect(() => {
    if (!incoming || !revealed) return;
    fallbackTimer.current = window.setTimeout(commit, 1500);
    return () => {
      if (fallbackTimer.current !== null) {
        clearTimeout(fallbackTimer.current);
        fallbackTimer.current = null;
      }
    };
  }, [incoming, revealed, commit]);

  // Auto-advance (disabled for reduced-motion users).
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => go(1), 6000);
    return () => clearInterval(t);
  }, [go, reduced]);

  // When the wipe finishes, promote the incoming image to current.
  const handleTransitionEnd = (e: TransitionEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName !== "clip-path" && e.propertyName !== "-webkit-clip-path") return;
    commit();
  };

  // Scroll to a hashed section when navigated to (e.g. /#how-it-works).
  useEffect(() => {
    if (!window.location.hash) return;
    const el = document.querySelector(window.location.hash);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, []);

  const prevIndex = (current - 1 + N) % N;
  const nextIndex = (current + 1) % N;

  // Each panel opens vertically from its center outward when revealed.
  const panelClip = revealed ? "inset(0 0 0 0)" : "inset(50% 0 50% 0)";

  // Track the cursor over the hero so the preview bubble can follow it. The
  // left half previews the previous slide; the right half previews the next.
  const onHeroMove = (e: ReactMouseEvent<HTMLElement>) => {
    const rect = heroRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dir: 1 | -1 = x < rect.width / 2 ? -1 : 1;
    // Throttle pointer updates to one per animation frame to avoid re-rendering
    // the hero on every raw mousemove event.
    if (pointerRaf.current !== null) return;
    pointerRaf.current = requestAnimationFrame(() => {
      pointerRaf.current = null;
      setPointer({ x, y, dir });
    });
  };
  const onHeroLeave = () => {
    if (pointerRaf.current !== null) {
      cancelAnimationFrame(pointerRaf.current);
      pointerRaf.current = null;
    }
    setPointer(null);
  };
  // Click an empty area of the hero to navigate (ignore clicks on buttons/links).
  const onHeroClick = (e: ReactMouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("a,button")) return;
    const rect = heroRef.current?.getBoundingClientRect();
    if (!rect) return;
    go(e.clientX - rect.left < rect.width / 2 ? -1 : 1);
  };

  return (
    <Layout>
      {/* ============ HERO (Patreon-style reveal carousel) ============ */}
      <section
        ref={heroRef}
        onMouseMove={onHeroMove}
        onMouseLeave={onHeroLeave}
        onClick={onHeroClick}
        className="relative h-[calc(100svh-5rem)] min-h-[600px] w-full overflow-hidden md:cursor-pointer"
      >
        {/* Slides */}
        <div className="absolute inset-0">
          {/* Current image */}
          <img
            src={HERO_IMAGES[current]}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Incoming image, revealed through staggered vertical panels that
              "open up" in sequence, left-to-right (mirroring Patreon's hero). */}
          {incoming && (
            <div className="absolute inset-0">
              {Array.from({ length: PANELS }).map((_, i) => {
                // Reveal order follows the navigation direction.
                const order = incoming.dir === 1 ? i : PANELS - 1 - i;
                const isLast = order === PANELS - 1;
                return (
                  <div
                    key={i}
                    className="absolute top-0 h-full overflow-hidden will-change-[clip-path]"
                    style={{
                      left: `${(i * 100) / PANELS}%`,
                      width: `${100 / PANELS}%`,
                      clipPath: panelClip,
                      WebkitClipPath: panelClip,
                      transition: revealed
                        ? `clip-path 760ms cubic-bezier(0.76, 0, 0.24, 1) ${order * 95}ms`
                        : "none",
                    }}
                    onTransitionEnd={isLast ? handleTransitionEnd : undefined}
                  >
                    {/* Full-bleed image, shifted so all panels tile seamlessly. */}
                    <img
                      src={HERO_IMAGES[incoming.index]}
                      alt=""
                      aria-hidden="true"
                      className="absolute top-0 h-full max-w-none object-cover"
                      style={{ width: `${PANELS * 100}%`, left: `${-i * 100}%` }}
                    />
                  </div>
                );
              })}
              {/* Subtle vignette for depth over the revealing panels. */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{ boxShadow: "inset 0 0 120px 0 rgba(0,0,0,0.5)" }}
              />
            </div>
          )}
          {/* Brand color wash + legibility gradients */}
          <div className="absolute inset-0 bg-secondary/10 mix-blend-overlay" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-background/30" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/30 to-transparent" />
        </div>

        {/* Carousel arrows */}
        <button
          onClick={() => go(-1)}
          aria-label="Previous slide"
          className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full border border-white/20 bg-background/30 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-primary hover:border-primary/60 transition-all"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button
          onClick={() => go(1)}
          aria-label="Next slide"
          className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full border border-white/20 bg-background/30 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-primary hover:border-primary/60 transition-all"
        >
          <ChevronRight className="h-6 w-6" />
        </button>

        {/* Living preview bubble that follows the cursor across the hero —
            previous slide on the left half, next slide on the right half. */}
        {pointer && (
          <div
            className="pointer-events-none absolute z-30 hidden md:block"
            style={{ left: pointer.x, top: pointer.y, transform: "translate(-50%, -50%)" }}
          >
            <div className="relative h-32 w-32 rounded-full overflow-hidden border-2 border-primary/80 shadow-[0_0_45px_rgba(212,175,55,0.55)] ring-4 ring-primary/10 animate-in fade-in zoom-in-75 duration-200">
              <img
                src={HERO_IMAGES[pointer.dir === -1 ? prevIndex : nextIndex]}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
              />
              <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/20" />
              <span className="pointer-events-none absolute -inset-1 rounded-full ring-1 ring-primary/40 animate-pulse" />
              <span className="absolute inset-x-0 bottom-0 text-center text-[10px] font-semibold uppercase tracking-widest text-white/90 bg-gradient-to-t from-black/70 to-transparent pb-1.5 pt-4">
                {pointer.dir === -1 ? "Prev" : "Next"}
              </span>
            </div>
          </div>
        )}

        {/* Hero copy */}
        <div className="relative z-10 h-full container mx-auto px-4 flex flex-col justify-end pb-16 md:pb-24">
          <div className="max-w-4xl">
            <Badge className="mb-6 bg-white/5 hover:bg-white/10 text-primary border-primary/20 backdrop-blur-md px-4 py-1.5 uppercase tracking-[0.2em] text-xs font-medium">
              The Premium Hookah Lounge · 21+
            </Badge>
            <h1 className="font-serif font-bold text-white leading-[0.95] tracking-tight text-5xl sm:text-7xl lg:text-[7rem] drop-shadow-[0_4px_30px_rgba(0,0,0,0.7)]">
              Your after-dark
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-[#F3E5AB] to-rose-400">
                lounge fantasy
              </span>
            </h1>
            <p className="mt-6 text-lg md:text-xl text-white/70 max-w-xl leading-relaxed">
              Connect with verified Dolls over a shared love of hookah. Exclusive content, private chats, and
              intimate video sessions — tasteful, glamorous, always after dark.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row gap-4">
              <Link href="/signup/member">
                <Button
                  size="lg"
                  className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground font-semibold tracking-widest uppercase h-14 px-9 shadow-[0_0_30px_rgba(212,175,55,0.4)] border-none"
                >
                  Join as a Member
                </Button>
              </Link>
              <Link href="/browse">
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full sm:w-auto border-white/30 text-white hover:bg-white/10 hover:text-white hover:border-primary font-semibold tracking-widest uppercase h-14 px-9 backdrop-blur-md bg-white/5"
                >
                  Browse Dolls
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Slide indicators */}
        <div className="absolute bottom-8 right-8 z-20 hidden md:flex items-center gap-2">
          {HERO_IMAGES.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === current ? "w-8 bg-primary" : "w-3 bg-white/30 hover:bg-white/60"
              }`}
            />
          ))}
        </div>

        {/* Scroll cue */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 text-white/50 animate-bounce hidden md:block">
          <ArrowDown className="h-6 w-6" />
        </div>
      </section>

      {/* ============ TRUST STRIP ============ */}
      <section className="border-y border-white/5 bg-card/30 backdrop-blur-md">
        <div className="container mx-auto px-4 py-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> 100% Verified Creators</span>
          <span className="flex items-center gap-2"><Star className="h-4 w-4 text-primary" /> Hookah in Every Post</span>
          <span className="flex items-center gap-2"><Lock className="h-4 w-4 text-primary" /> Private & Secure</span>
          <span className="flex items-center gap-2"><Video className="h-4 w-4 text-primary" /> 1-on-1 Video Lounge</span>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section id="how-it-works" className="py-24 relative z-10 scroll-mt-20">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mb-16">
            <p className="text-primary uppercase tracking-[0.25em] text-xs font-semibold mb-4">How it works</p>
            <h2 className="text-3xl md:text-5xl font-serif font-bold text-white leading-tight">
              Everything you need to enjoy the lounge.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: ShieldCheck,
                title: "Verified Dolls only",
                body: "Every creator is identity-verified before they earn a single credit. Authentic profiles, real connections.",
              },
              {
                icon: MessageSquare,
                title: "Message & unlock",
                body: "Spend credits to start conversations and unlock premium photos and videos from your favorite Dolls.",
              },
              {
                icon: Video,
                title: "Private video sessions",
                body: "Book intimate 1-on-1 video lounge time. Set the mood, light the coals, and enjoy the evening.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="group bg-card/50 backdrop-blur-md border border-white/5 rounded-2xl p-8 hover:bg-card/80 hover:border-primary/30 transition-all duration-500 hover:-translate-y-1"
              >
                <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center mb-6 shadow-[0_0_15px_rgba(212,175,55,0.15)] group-hover:scale-110 transition-transform">
                  <f.icon className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-xl font-serif font-bold text-white mb-3">{f.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FEATURED DOLLS ============ */}
      <section className="py-24 relative z-10 border-t border-white/5">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
            <div>
              <p className="text-primary uppercase tracking-[0.25em] text-xs font-semibold mb-4">Tonight's lineup</p>
              <h2 className="text-3xl md:text-5xl font-serif font-bold text-white">Featured Dolls</h2>
            </div>
            <Link href="/browse">
              <Button variant="ghost" className="text-primary hover:text-primary hover:bg-primary/10">
                View all Dolls <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {dolls.length > 0 ? (
              dolls.slice(0, 4).map((doll) => (
                <Link key={doll.id} href={`/dolls/${doll.id}`} className="group block">
                  <div className="relative aspect-[3/4] w-full rounded-2xl overflow-hidden border border-white/5 group-hover:border-primary/50 transition-all duration-500 shadow-lg group-hover:shadow-[0_0_30px_rgba(212,175,55,0.2)] bg-card">
                    <img
                      src={doll.profilePhotoUrl!}
                      alt={doll.stageName}
                      className="object-cover w-full h-full opacity-90 group-hover:opacity-100 transition-all duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
                    <div className="absolute top-3 right-3 flex flex-col gap-2 items-end">
                      {doll.online && (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/50 backdrop-blur-md text-[10px]">
                          Online
                        </Badge>
                      )}
                      {doll.elite && (
                        <Badge className="bg-primary/20 text-primary border-primary/50 backdrop-blur-md text-[10px]">
                          Elite
                        </Badge>
                      )}
                    </div>
                    <div className="absolute bottom-0 left-0 p-4 w-full">
                      <div className="flex items-center gap-1.5 mb-1">
                        <h3 className="font-serif text-lg font-bold text-white group-hover:text-primary transition-colors">
                          {doll.stageName}
                        </h3>
                        {doll.verified && <ShieldCheck className="w-4 h-4 text-primary" />}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {doll.city}, {doll.state}
                      </p>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="col-span-full py-12 text-center text-muted-foreground bg-card/30 rounded-2xl border border-white/5">
                No featured Dolls at the moment. Check back soon!
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============ FOR CREATORS BAND ============ */}
      <section className="py-24 relative z-10 border-t border-white/5">
        <div className="container mx-auto px-4">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-card/50 backdrop-blur-md p-10 md:p-16">
            <div className="absolute -top-24 -right-24 w-96 h-96 bg-secondary/15 blur-[120px] rounded-full pointer-events-none" />
            <div className="relative z-10 max-w-2xl">
              <p className="text-secondary uppercase tracking-[0.25em] text-xs font-semibold mb-4">For Dolls</p>
              <h2 className="text-3xl md:text-5xl font-serif font-bold text-white mb-6 leading-tight">
                Turn your lounge nights into income.
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Get verified, set your own prices, and earn from subscriptions, premium content, messages, and video
                sessions. You're always in control.
              </p>
              <Link href="/signup/doll">
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-primary to-rose-400 hover:opacity-90 text-primary-foreground font-bold tracking-widest uppercase h-14 px-9 shadow-[0_0_40px_rgba(232,93,117,0.35)] border-none"
                >
                  Become a Doll
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="py-28 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-[300px] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="container mx-auto px-4 relative z-10 text-center max-w-3xl">
          <h2 className="text-4xl md:text-6xl font-serif font-bold text-white mb-6 leading-tight">
            The lounge is open.
          </h2>
          <p className="text-lg text-muted-foreground mb-10">
            Join thousands enjoying premium content, private chats, and exclusive connections with verified Hookah Dolls.
          </p>
          <Link href="/signup/member">
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold tracking-widest uppercase h-14 px-12 shadow-[0_0_40px_rgba(212,175,55,0.4)] border-none"
            >
              Create your free account
            </Button>
          </Link>
          <p className="mt-6 text-xs text-muted-foreground/60 uppercase tracking-widest">Strictly 21+ · Discreet billing</p>
        </div>
      </section>
    </Layout>
  );
}
