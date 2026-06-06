import { Layout } from "@/components/Layout";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useListFeaturedDolls } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Star, ShieldCheck, Video, Heart } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const { data: featuredDolls, isLoading } = useListFeaturedDolls();

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative min-h-[90svh] flex items-center justify-center overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 pointer-events-none">
          {/* Subtle smoke/glow effects */}
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] mix-blend-screen opacity-50 animate-pulse" style={{ animationDuration: '8s' }} />
          <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-secondary/10 rounded-full blur-[150px] mix-blend-screen opacity-40 animate-pulse" style={{ animationDuration: '12s' }} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/80 to-background" />
        </div>

        <div className="container mx-auto px-4 relative z-10 flex flex-col items-center text-center pt-20 pb-32">
          <Badge className="mb-6 bg-white/5 hover:bg-white/10 text-primary border-primary/20 backdrop-blur-md px-4 py-1.5 uppercase tracking-widest font-medium">
            The Premium Lounge Experience
          </Badge>
          
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-serif font-bold tracking-wider mb-6 text-white drop-shadow-[0_0_25px_rgba(212,175,55,0.4)] max-w-5xl leading-tight">
            HookahDolls<span className="text-primary">.com</span>
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-12 leading-relaxed">
            A tasteful, hookah-centered social platform connecting Verified Dolls and enthusiasts. Step into the lounge after dark.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-6 w-full max-w-md justify-center">
            <Link href="/signup/member" className="w-full sm:w-auto">
              <Button size="lg" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold tracking-widest uppercase h-14 px-8 shadow-[0_0_30px_rgba(212,175,55,0.4)] border-none">
                I Love Dolls
              </Button>
            </Link>
            <Link href="/signup/doll" className="w-full sm:w-auto">
              <Button size="lg" variant="outline" className="w-full border-primary/50 text-white hover:bg-primary/10 hover:text-white hover:border-primary font-semibold tracking-widest uppercase h-14 px-8 backdrop-blur-md">
                I'm a Doll
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 bg-background relative z-10 border-b border-white/5">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-white mb-4">The Experience</h2>
            <div className="h-1 w-20 bg-gradient-to-r from-transparent via-primary to-transparent mx-auto"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="bg-card/50 backdrop-blur-md border border-white/5 rounded-2xl p-8 text-center hover:bg-card/80 transition-all duration-500 hover:-translate-y-1">
              <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-6 shadow-[0_0_15px_rgba(212,175,55,0.2)]">
                <ShieldCheck className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-serif font-bold text-white mb-3">100% Verified Dolls</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Every creator is strictly verified. Authentic profiles, real connections, and premium content you won't find anywhere else.
              </p>
            </div>

            <div className="bg-card/50 backdrop-blur-md border border-white/5 rounded-2xl p-8 text-center hover:bg-card/80 transition-all duration-500 hover:-translate-y-1">
              <div className="w-16 h-16 rounded-full bg-secondary/10 border border-secondary/30 flex items-center justify-center mx-auto mb-6 shadow-[0_0_15px_rgba(232,93,117,0.2)]">
                <Star className="w-8 h-8 text-secondary" />
              </div>
              <h3 className="text-xl font-serif font-bold text-white mb-3">Hookah Centered</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Our strict aesthetic rule: a visible hookah in all content. We curate a tasteful, glamorous lounge atmosphere.
              </p>
            </div>

            <div className="bg-card/50 backdrop-blur-md border border-white/5 rounded-2xl p-8 text-center hover:bg-card/80 transition-all duration-500 hover:-translate-y-1">
              <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-6 shadow-[0_0_15px_rgba(212,175,55,0.2)]">
                <Video className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-serif font-bold text-white mb-3">Private Video Chats</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Unlock exclusive content, send private messages, and request 1-on-1 video lounge sessions with your favorite Dolls.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Dolls */}
      <section className="py-24 relative z-10">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
            <div>
              <h2 className="text-3xl md:text-4xl font-serif font-bold text-white mb-4">Featured Dolls</h2>
              <p className="text-muted-foreground">Discover the most captivating creators in the lounge.</p>
            </div>
            <Link href="/browse">
              <Button variant="ghost" className="text-primary hover:text-primary hover:bg-primary/10">
                View All Dolls &rarr;
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col space-y-3">
                  <Skeleton className="h-[350px] w-full rounded-2xl bg-card" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-[150px] bg-card" />
                    <Skeleton className="h-4 w-[100px] bg-card" />
                  </div>
                </div>
              ))
            ) : featuredDolls && featuredDolls.length > 0 ? (
              featuredDolls.slice(0, 4).map((doll) => (
                <Link key={doll.id} href={`/dolls/${doll.id}`} className="group block">
                  <div className="relative h-[350px] w-full rounded-2xl overflow-hidden mb-4 border border-white/5 group-hover:border-primary/50 transition-all duration-500 shadow-lg group-hover:shadow-[0_0_30px_rgba(212,175,55,0.2)] bg-card">
                    {doll.profilePhotoUrl ? (
                      <img src={doll.profilePhotoUrl} alt={doll.stageName} className="object-cover w-full h-full opacity-80 group-hover:opacity-100 transition-opacity duration-500 group-hover:scale-105" />
                    ) : (
                      <div className="w-full h-full bg-card flex items-center justify-center">
                        <UserPlaceholder />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent opacity-80" />
                    <div className="absolute bottom-0 left-0 p-5 w-full">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-serif text-xl font-bold text-white group-hover:text-primary transition-colors">{doll.stageName}</h3>
                        {doll.verified && <ShieldCheck className="w-4 h-4 text-primary" />}
                      </div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        {doll.city}, {doll.state}
                      </p>
                    </div>
                    <div className="absolute top-4 right-4 flex flex-col gap-2">
                      {doll.online && (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/50 backdrop-blur-md">Online</Badge>
                      )}
                      {doll.elite && (
                        <Badge className="bg-primary/20 text-primary border-primary/50 backdrop-blur-md">Elite</Badge>
                      )}
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="col-span-full py-12 text-center text-muted-foreground bg-card/30 rounded-2xl border border-white/5">
                No featured dolls at the moment. Check back soon!
              </div>
            )}
          </div>
        </div>
      </section>

      {/* CTA Block */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-card/40 backdrop-blur-md border-y border-white/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-[300px] bg-primary/10 blur-[100px] rounded-full pointer-events-none" />
        
        <div className="container mx-auto px-4 relative z-10 text-center max-w-3xl">
          <h2 className="text-4xl font-serif font-bold text-white mb-6">Ready to enter the lounge?</h2>
          <p className="text-lg text-muted-foreground mb-10">
            Join thousands of members enjoying premium content, private chats, and exclusive connections with verified Hookah Dolls.
          </p>
          <Link href="/signup/member">
            <Button size="lg" className="bg-gradient-to-r from-primary to-rose-400 hover:from-primary/90 hover:to-rose-400/90 text-primary-foreground font-bold tracking-widest uppercase h-14 px-10 shadow-[0_0_40px_rgba(232,93,117,0.4)] border-none">
              Create Free Account
            </Button>
          </Link>
        </div>
      </section>
    </Layout>
  );
}

function UserPlaceholder() {
  return (
    <svg className="w-24 h-24 text-muted/50" fill="currentColor" viewBox="0 0 24 24">
      <path d="M24 20.993V24H0v-2.996A14.977 14.977 0 0112.004 15c4.904 0 9.26 2.354 11.996 5.993zM16.002 8.999a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}
