import { Link } from "wouter";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col relative overflow-hidden bg-background">
      {/* Dynamic smoke/gradient background matching the dark luxury brand */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        {/* Deep background color */}
        <div className="absolute inset-0 bg-[#0c0812]" />
        
        {/* Glowing orbs for depth */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-rose-400/5 blur-[120px]" />
        
        {/* Subtle noise texture */}
        <div className="absolute inset-0 opacity-[0.015] bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
      </div>

      <div className="relative z-10 flex flex-col flex-1">
        <main className="flex-1 flex flex-col">
          {children}
        </main>

        <footer className="mt-auto border-t border-white/5 bg-background/50 backdrop-blur-lg">
          <div className="container mx-auto px-4 py-12">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div className="md:col-span-2">
                <Link href="/" className="font-serif text-2xl font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-primary via-[#F3E5AB] to-rose-400">
                  HookahDolls
                </Link>
                <p className="mt-4 text-sm text-muted-foreground max-w-sm">
                  The premier social network for adult members and verified creators who share a love for hookah culture. Tasteful, glamorous, and always after dark.
                </p>
              </div>
              
              <div>
                <h4 className="text-white font-semibold mb-4 tracking-wider uppercase text-xs">Community</h4>
                <ul className="space-y-2">
                  <li><Link href="/browse" className="text-sm text-muted-foreground hover:text-primary transition-colors">Browse Dolls</Link></li>
                  <li><Link href="/feed" className="text-sm text-muted-foreground hover:text-primary transition-colors">The Feed</Link></li>
                  <li><Link href="/lounges" className="text-sm text-muted-foreground hover:text-primary transition-colors">Find Lounges</Link></li>
                  <li><Link href="/choose-membership" className="text-sm text-muted-foreground hover:text-primary transition-colors">Become a Member</Link></li>
                  <li><Link href="/signup/doll" className="text-sm text-muted-foreground hover:text-primary transition-colors">Apply as a Doll</Link></li>
                </ul>
              </div>

              <div>
                <h4 className="text-white font-semibold mb-4 tracking-wider uppercase text-xs">Support</h4>
                <ul className="space-y-2">
                  <li><Link href="/pricing" className="text-sm text-muted-foreground hover:text-primary transition-colors">Pricing & Credits</Link></li>
                  <li><Link href="/contact" className="text-sm text-muted-foreground hover:text-primary transition-colors">Contact Us</Link></li>
                  <li><Link href="/terms" className="text-sm text-muted-foreground hover:text-primary transition-colors">Terms of Service</Link></li>
                  <li><Link href="/privacy" className="text-sm text-muted-foreground hover:text-primary transition-colors">Privacy Policy</Link></li>
                  <li><Link href="/content-rules" className="text-sm text-muted-foreground hover:text-primary transition-colors">Content Rules</Link></li>
                </ul>
              </div>
            </div>
            
            <div className="mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                &copy; {new Date().getFullYear()} HookahDolls. All rights reserved. You must be 21+ to enter.
              </p>
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground">Premium content unlocked</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}