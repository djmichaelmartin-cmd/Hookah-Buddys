import { Layout } from "@/components/Layout";
import { Link } from "wouter";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type TransitionEvent,
  type MouseEvent as ReactMouseEvent,
  type CSSProperties,
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
  Sparkles,
  Heart,
  Check,
  DollarSign,
  Upload,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;
const HERO_IMAGES = [1, 2, 3, 4, 5].map((i) => `${BASE}lounge/lounge${i}.png`);
const N = HERO_IMAGES.length;
// Organic "blob" outline (normalized to a 0..1 bounding box, centered) that
// scales up from a point to reveal the incoming hero image — mirroring
// Patreon's hero transition.
const BLOB_PATH =
  "M0.5,0.03 C0.64,0.03 0.78,0.08 0.87,0.19 C0.96,0.29 1.0,0.43 0.98,0.56 C0.96,0.70 0.88,0.83 0.76,0.91 C0.64,0.98 0.48,1.0 0.34,0.96 C0.20,0.91 0.08,0.81 0.04,0.67 C0.0,0.53 0.02,0.37 0.10,0.25 C0.18,0.13 0.31,0.05 0.45,0.03 C0.47,0.03 0.48,0.03 0.5,0.03 Z";
// Reveal/settle timing (kept in sync so the commit fires when both finish).
const REVEAL_MS = 1500;

export default function Home() {
  const { data: featuredDolls } = useListFeaturedDolls();
  const dolls = (featuredDolls ?? []).filter((d) => d.profilePhotoUrl);

  // ---- Featured Dolls marquee ----
  // Repeat the lineup until there are enough tiles to span wide screens, then
  // render the set twice so a -50% CSS translate loops seamlessly (tiles drift
  // left and recycle in from the right). Slower for shorter lineups.
  const MARQUEE_MIN_TILES = 8;
  const marqueeBase =
    dolls.length > 0
      ? Array.from(
          { length: Math.max(1, Math.ceil(MARQUEE_MIN_TILES / dolls.length)) },
          () => dolls,
        ).flat()
      : [];
  const marqueeLoop = [...marqueeBase, ...marqueeBase];
  const marqueeDuration = `${Math.max(40, marqueeBase.length * 6)}s`;

  // ---- Featured Dolls parallax backdrop ----
  // Drift the smoky lounge image slower than the page scroll. The image layer
  // is oversized (±25%) so the transform never reveals an edge. Disabled for
  // reduced-motion users, who simply get the static darkened backdrop.
  const featuredRef = useRef<HTMLElement>(null);
  const featuredBgRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const section = featuredRef.current;
      const bg = featuredBgRef.current;
      if (!section || !bg) return;
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (rect.bottom < 0 || rect.top > vh) return;
      const offset = rect.top + rect.height / 2 - vh / 2;
      bg.style.transform = `translate3d(0, ${(offset * -0.12).toFixed(2)}px, 0)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // ---- Hero reveal carousel (atmospheric lounge imagery) ----
  // The next image is "opened up" over the current one with an animated
  // clip-path wipe, mirroring Patreon's hero transition.
  const [current, setCurrent] = useState(0);
  const [incoming, setIncoming] = useState<{ index: number; dir: 1 | -1 } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [reduced, setReduced] = useState(false);
  // Cursor-tracking preview bubble over the hero.
  const [pointer, setPointer] = useState<
    { x: number; y: number; dir: 1 | -1; w: number; h: number } | null
  >(null);
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
    fallbackTimer.current = window.setTimeout(commit, REVEAL_MS + 700);
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

  // When the blob reveal finishes, promote the incoming image to current.
  const handleTransitionEnd = (e: TransitionEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName !== "transform") return;
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

  // The blob grows from a point (scale 0) to fully cover the hero.
  const blobScale = revealed ? "scale(2.4) rotate(7deg)" : "scale(0)";

  // Diameter of the cursor lens that reveals the adjacent slide.
  const LENS = 420;

  // Track the cursor over the hero so the preview bubble can follow it. The
  // left half previews the previous slide; the right half previews the next.
  const onHeroMove = (e: ReactMouseEvent<HTMLElement>) => {
    const rect = heroRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const dir: 1 | -1 = x < w / 2 ? -1 : 1;
    // Throttle pointer updates to one per animation frame to avoid re-rendering
    // the hero on every raw mousemove event.
    if (pointerRaf.current !== null) return;
    pointerRaf.current = requestAnimationFrame(() => {
      pointerRaf.current = null;
      setPointer({ x, y, dir, w, h });
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
        className="relative -mt-28 h-svh min-h-[600px] w-full overflow-hidden md:cursor-pointer"
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
          {/* Incoming image, revealed through an organic blob that opens up
              from a point and grows to cover the hero (mirroring Patreon). */}
          {incoming && (
            <div className="absolute inset-0">
              <svg className="absolute h-0 w-0" aria-hidden="true">
                <defs>
                  <clipPath id="hero-blob" clipPathUnits="objectBoundingBox">
                    <path
                      d={BLOB_PATH}
                      style={{
                        transformBox: "fill-box",
                        transformOrigin:
                          incoming.dir === 1 ? "42% 58%" : "58% 42%",
                        transform: blobScale,
                        transition: revealed
                          ? `transform ${REVEAL_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`
                          : "none",
                      }}
                    />
                  </clipPath>
                </defs>
              </svg>
              <img
                src={HERO_IMAGES[incoming.index]}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover will-change-transform"
                style={{
                  clipPath: "url(#hero-blob)",
                  WebkitClipPath: "url(#hero-blob)",
                  transform: revealed ? "scale(1)" : "scale(1.1)",
                  transition: revealed
                    ? `transform ${REVEAL_MS + 300}ms cubic-bezier(0.22, 1, 0.36, 1)`
                    : "none",
                }}
                onTransitionEnd={handleTransitionEnd}
              />
              {/* Subtle vignette for depth, clipped to the same blob. */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  clipPath: "url(#hero-blob)",
                  WebkitClipPath: "url(#hero-blob)",
                  boxShadow: "inset 0 0 120px 0 rgba(0,0,0,0.5)",
                }}
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
            <div className="animate-in fade-in zoom-in-90 duration-200">
              <div
                className="animate-blob relative overflow-hidden shadow-[0_20px_70px_rgba(0,0,0,0.55)]"
                style={{ width: LENS, height: LENS }}
              >
                {/* Full-size adjacent slide, offset so the slice under the
                    cursor lines up exactly with the hero beneath it — a true
                    lens that reveals only the hovered portion. */}
                <img
                  src={HERO_IMAGES[pointer.dir === -1 ? prevIndex : nextIndex]}
                  alt=""
                  aria-hidden="true"
                  className="absolute max-w-none object-cover"
                  style={{
                    width: pointer.w,
                    height: pointer.h,
                    left: LENS / 2 - pointer.x,
                    top: LENS / 2 - pointer.y,
                  }}
                />
                <span className="animate-blob pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/15" />
              </div>
            </div>
          </div>
        )}

        {/* Hero copy */}
        <div className="relative z-10 h-full container mx-auto px-4 flex flex-col justify-center pb-24">
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
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 hidden md:flex items-center gap-2">
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

        {/* Scroll cue — bold white arrow that drifts down, fades out and reappears */}
        <button
          onClick={() => window.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" })}
          aria-label="Scroll to next section"
          className="absolute bottom-8 right-8 z-20 text-white animate-scroll-cue drop-shadow-[0_2px_12px_rgba(0,0,0,0.75)] hidden md:block"
        >
          <ArrowDown className="h-24 w-24" strokeWidth={2.5} />
        </button>
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

      {/* ============ JOIN PATHS (two tiles) ============ */}
      <section className="py-24 relative z-10">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center mb-14">
            <p className="text-primary uppercase tracking-[0.25em] text-xs font-semibold mb-4">
              Choose your side of the lounge
            </p>
            <h2 className="text-3xl md:text-5xl font-serif font-bold text-white leading-tight">
              Two ways to join HookahDolls.
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
            {/* I'm a Doll */}
            <div className="group relative overflow-hidden rounded-3xl border border-rose-400/20 bg-card/50 backdrop-blur-md p-8 md:p-10 hover:border-rose-400/50 transition-all duration-500 hover:-translate-y-1">
              <div className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-rose-400/10 blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="relative mb-6 -mx-8 -mt-8 md:-mx-10 md:-mt-10 overflow-hidden rounded-t-3xl">
                  <img
                    src="/join/im-a-doll.png"
                    alt="A glamorous woman relaxing with a hookah in an upscale lounge"
                    loading="lazy"
                    className="h-52 md:h-60 w-full object-cover object-center transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
                </div>
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-14 h-14 rounded-xl bg-rose-400/10 border border-rose-400/30 flex items-center justify-center shadow-[0_0_15px_rgba(232,93,117,0.2)] group-hover:scale-110 transition-transform">
                    <Sparkles className="w-7 h-7 text-rose-400" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-serif font-bold text-white">I'm a Doll</h3>
                    <p className="text-sm text-muted-foreground">For verified women creators</p>
                  </div>
                </div>

                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Build a stunning profile, set your own pace, and earn from members
                  who love hookah culture. Every Doll is identity-verified, and all
                  content features a visible hookah — tasteful, glamorous, always after dark.
                </p>

                <p className="text-xs uppercase tracking-[0.2em] text-rose-400/90 font-semibold mb-3">
                  What you'll set up
                </p>
                <ul className="space-y-2.5 mb-8">
                  {[
                    "Legal name, stage name, email & password",
                    "City, state, age & favorite hookah flavor",
                    "A short bio that sets your vibe",
                    "Identity verification — 21+ & hookah-in-content agreement",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-zinc-300">
                      <Check className="h-4 w-4 mt-0.5 shrink-0 text-rose-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-8 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5 text-rose-400" /> Get paid</span>
                  <span className="flex items-center gap-1.5"><Upload className="h-3.5 w-3.5 text-rose-400" /> Post content</span>
                  <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-rose-400" /> Verified badge</span>
                </div>

                <Link href="/signup/doll">
                  <Button className="w-full h-12 rounded-full bg-rose-400 text-zinc-900 font-semibold hover:bg-rose-300 transition-colors">
                    Create my Doll profile <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <p className="text-center text-xs text-muted-foreground mt-3">
                  Free to apply · Approval after verification
                </p>
              </div>
            </div>

            {/* I Love Dolls */}
            <div className="group relative overflow-hidden rounded-3xl border border-primary/20 bg-card/50 backdrop-blur-md p-8 md:p-10 hover:border-primary/50 transition-all duration-500 hover:-translate-y-1">
              <div className="absolute -top-24 -right-24 h-56 w-56 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="relative mb-6 -mx-8 -mt-8 md:-mx-10 md:-mt-10 overflow-hidden rounded-t-3xl">
                  <img
                    src="/join/i-love-dolls.png"
                    alt="A stylish couple enjoying a hookah together in an upscale lounge"
                    loading="lazy"
                    className="h-52 md:h-60 w-full object-cover object-center transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
                </div>
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center shadow-[0_0_15px_rgba(212,175,55,0.2)] group-hover:scale-110 transition-transform">
                    <Heart className="w-7 h-7 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-serif font-bold text-white">I Love Dolls</h3>
                    <p className="text-sm text-muted-foreground">For members &amp; fans</p>
                  </div>
                </div>

                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Browse verified Dolls, unlock exclusive content, and start private
                  conversations. Buy credits once and spend them on the connections
                  and moments that matter most to you.
                </p>

                <p className="text-xs uppercase tracking-[0.2em] text-primary/90 font-semibold mb-3">
                  What you'll set up
                </p>
                <ul className="space-y-2.5 mb-8">
                  {[
                    "Full name, username, email & password",
                    "Optional city & state for nearby Dolls",
                    "A quick 21+ confirmation & Terms agreement",
                    "Add credits whenever you're ready to unlock",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-zinc-300">
                      <Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-8 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5 text-primary" /> Private chats</span>
                  <span className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-primary" /> Unlock media</span>
                  <span className="flex items-center gap-1.5"><Video className="h-3.5 w-3.5 text-primary" /> Video lounge</span>
                </div>

                <Link href="/signup/member">
                  <Button className="w-full h-12 rounded-full bg-primary text-zinc-900 font-semibold hover:bg-primary/90 transition-colors">
                    Create my member profile <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <p className="text-center text-xs text-muted-foreground mt-3">
                  Free to join · Pay only for what you unlock
                </p>
              </div>
            </div>
          </div>
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
      <section
        ref={featuredRef}
        className="py-24 relative z-10 border-t border-white/5 overflow-hidden"
      >
        {/* Parallax smoky hookah-lounge backdrop */}
        <div
          ref={featuredBgRef}
          aria-hidden
          className="absolute inset-x-0 -top-[25%] h-[150%] z-0 will-change-transform pointer-events-none"
        >
          <img
            src={`${BASE}lounge/lounge2.png`}
            alt=""
            className="w-full h-full object-cover"
          />
          {/* Darken + smoky haze so the lineup stays legible */}
          <div className="absolute inset-0 bg-background/60" />
          <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_35%,_rgba(0,0,0,0.55)_100%)]" />
        </div>

        <div className="container mx-auto px-4 relative z-10">
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

          {dolls.length > 0 ? (
            <div className="marquee">
              <div
                className="marquee-track"
                style={{ "--marquee-duration": marqueeDuration } as CSSProperties}
              >
                {marqueeLoop.map((doll, i) => (
                  <Link
                    key={`${doll.id}-${i}`}
                    href={`/dolls/${doll.id}`}
                    className="group block shrink-0 w-56 sm:w-64 md:w-72 mr-4 md:mr-6"
                    aria-hidden={i >= marqueeBase.length || undefined}
                    tabIndex={i >= marqueeBase.length ? -1 : undefined}
                  >
                  <div className="relative aspect-[3/4] w-full rounded-2xl overflow-hidden border border-white/5 group-hover:border-primary/50 transition-all duration-500 shadow-lg group-hover:shadow-[0_0_30px_rgba(212,175,55,0.2)] bg-card">
                    <img
                      src={doll.profilePhotoUrl!}
                      alt={doll.stageName}
                      className="object-cover w-full h-full opacity-90 group-hover:opacity-100 transition-all duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
                    <div className="absolute top-3 left-3 flex flex-col gap-2 items-start">
                      {doll.featured && (
                        <Badge className="bg-secondary/25 text-secondary border-secondary/50 backdrop-blur-md text-[10px] gap-1">
                          <Star className="h-3 w-3 fill-current" /> Featured
                        </Badge>
                      )}
                      {doll.verified && (
                        <Badge className="bg-primary/20 text-primary border-primary/50 backdrop-blur-md text-[10px] gap-1">
                          <ShieldCheck className="h-3 w-3" /> Verified
                        </Badge>
                      )}
                    </div>
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
                      <Button
                        size="sm"
                        className="mt-3 w-full bg-white/10 hover:bg-primary text-white hover:text-primary-foreground border border-white/15 hover:border-primary backdrop-blur-md font-medium tracking-wide uppercase text-[11px] transition-all"
                      >
                        View Profile <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground bg-card/30 rounded-2xl border border-white/5">
              No featured Dolls at the moment. Check back soon!
            </div>
          )}
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
