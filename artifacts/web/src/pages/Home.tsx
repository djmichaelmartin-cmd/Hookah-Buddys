import { Layout } from "@/components/Layout";
import { Link } from "wouter";
import { useState, useEffect, useCallback, useRef, type TransitionEvent } from "react";
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

const HERO_FALLBACK = `${import.meta.env.BASE_URL}dolls/hero.png`;

export default function Home() {
  const { data: featuredDolls } = useListFeaturedDolls();
  const slides = (featuredDolls ?? []).filter((d) => d.profilePhotoUrl).slice(0, 5);
  const n = slides.length;
  const hasLoop = n > 1;

  // Track with a clone of the last slide prepended and the first slide
  // appended so the horizontal slide can loop seamlessly in both directions
  // (the same effect Patreon's hero uses).
  const track = hasLoop ? [slides[n - 1], ...slides, slides[0]] : slides;

  // `pos` is the index into `track`; real slides occupy positions 1..n.
  const [pos, setPos] = useState(hasLoop ? 1 : 0);
  const [animate, setAnimate] = useState(true);

  const realIndex = hasLoop ? (((pos - 1) % n) + n) % n : 0;

  // Locks navigation while a slide transition is in flight so rapid clicks
  // can't push `pos` past the sentinel clones before the snap-back runs.
  const moving = useRef(false);

  // Reset when the slide set changes (async load / refetch).
  useEffect(() => {
    moving.current = false;
    setAnimate(false);
    setPos(hasLoop ? 1 : 0);
  }, [n, hasLoop]);

  const go = useCallback((dir: number) => {
    if (moving.current) return;
    moving.current = true;
    setAnimate(true);
    setPos((p) => p + dir);
  }, []);

  const goTo = useCallback((i: number) => {
    setPos((p) => {
      if (moving.current || p === i + 1) return p;
      moving.current = true;
      setAnimate(true);
      return i + 1;
    });
  }, []);

  // After a silent snap-back to a real slide, re-enable the transition on the
  // next frame so the following move animates again.
  useEffect(() => {
    if (animate) return;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setAnimate(true)),
    );
    return () => cancelAnimationFrame(id);
  }, [animate]);

  // Auto-advance (disabled for reduced-motion users and single slides).
  useEffect(() => {
    if (!hasLoop) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const t = setInterval(() => go(1), 6000);
    return () => clearInterval(t);
  }, [hasLoop, go]);

  // When a clone scrolls fully into view, jump (without animating) to the
  // matching real slide so the loop is invisible.
  const handleTransitionEnd = (e: TransitionEvent) => {
    if (e.propertyName !== "transform") return;
    moving.current = false;
    if (!hasLoop) return;
    if (pos >= n + 1) {
      setAnimate(false);
      setPos(1);
    } else if (pos <= 0) {
      setAnimate(false);
      setPos(n);
    }
  };

  const current = slides[realIndex] ?? slides[0];

  return (
    <Layout>
      {/* ============ HERO (Patreon-style immersive carousel) ============ */}
      <section className="relative h-[calc(100svh-4rem)] min-h-[600px] w-full overflow-hidden">
        {/* Background slides — horizontal sliding track (Patreon-style) */}
        <div className="absolute inset-0 overflow-hidden">
          {n > 0 ? (
            <div
              className="flex h-full w-full"
              style={{
                transform: `translateX(-${pos * 100}%)`,
                transition: animate
                  ? "transform 800ms cubic-bezier(0.7, 0, 0.2, 1)"
                  : "none",
              }}
              onTransitionEnd={handleTransitionEnd}
            >
              {track.map((d, i) => (
                <img
                  key={`${d.id}-${i}`}
                  src={d.profilePhotoUrl!}
                  alt=""
                  aria-hidden="true"
                  className="h-full w-full shrink-0 object-cover"
                />
              ))}
            </div>
          ) : (
            <img src={HERO_FALLBACK} alt="HookahDolls lounge" className="absolute inset-0 h-full w-full object-cover" />
          )}
          {/* Brand color wash + legibility gradients */}
          <div className="absolute inset-0 bg-secondary/10 mix-blend-overlay" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-background/30" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/30 to-transparent" />
        </div>

        {/* Carousel arrows */}
        {hasLoop && (
          <>
            <button
              onClick={() => go(-1)}
              aria-label="Previous"
              className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full border border-white/20 bg-background/30 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-primary hover:border-primary/60 transition-all"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              onClick={() => go(1)}
              aria-label="Next"
              className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full border border-white/20 bg-background/30 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-primary hover:border-primary/60 transition-all"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
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

        {/* Spotlight chip (active doll) */}
        {current && (
          <Link
            href={`/dolls/${current.id}`}
            className="hidden lg:flex absolute right-8 top-1/2 -translate-y-1/2 z-20 items-center gap-4 max-w-xs group"
          >
            <div className="relative h-16 w-16 shrink-0 rounded-full overflow-hidden border-2 border-primary/60 shadow-[0_0_25px_rgba(212,175,55,0.35)]">
              <img src={current.profilePhotoUrl!} alt={current.stageName} className="h-full w-full object-cover" />
            </div>
            <p className="text-white/90 text-sm leading-snug">
              <span className="font-serif text-primary text-base">{current.stageName}</span> is lighting up{" "}
              {current.city}, {current.state}
              <ArrowRight className="inline-block ml-1 h-4 w-4 -translate-y-px group-hover:translate-x-1 transition-transform" />
            </p>
          </Link>
        )}

        {/* Slide indicators */}
        {hasLoop && (
          <div className="absolute bottom-8 right-8 z-20 hidden md:flex items-center gap-2">
            {slides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === realIndex ? "w-8 bg-primary" : "w-3 bg-white/30 hover:bg-white/60"
                }`}
              />
            ))}
          </div>
        )}

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
      <section className="py-24 relative z-10">
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
            {slides.length > 0 ? (
              slides.slice(0, 4).map((doll) => (
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
