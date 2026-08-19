import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="bg-background border-t border-white/5 py-12 mt-auto relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-20" style={{ background: 'radial-gradient(circle at center, var(--primary) 0%, transparent 70%)', mixBlendMode: 'screen' }} />
      <div className="container mx-auto px-4 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div className="col-span-1 md:col-span-2">
            <h3 className="font-serif text-2xl font-bold tracking-widest text-primary mb-4">HookahBuddys</h3>
            <p className="text-muted-foreground max-w-sm mb-4">

              A premium, upscale platform connecting Verified Buddys and enthusiasts through a shared love of hookah culture. Tasteful, glamorous, and always 21+.
            </p>
            <p className="text-xs text-muted-foreground/60 max-w-sm">
              All content on HookahBuddys must feature a visible hookah. We enforce strict guidelines to maintain our premium lounge atmosphere.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-white mb-4 uppercase tracking-wider text-sm">Platform</h4>
            <ul className="space-y-2">
              <li><Link href="/browse" className="text-muted-foreground hover:text-primary transition-colors text-sm">Browse Buddys</Link></li>
              <li><Link href="/pricing" className="text-sm text-muted-foreground hover:text-primary transition-colors">Pricing & Plans</Link></li>
              <li><Link href="/signup/doll" className="text-sm text-muted-foreground hover:text-primary transition-colors">Become a Buddy</Link></li>
              <li><Link href="/choose-membership" className="text-sm text-muted-foreground hover:text-primary transition-colors">Create Free Profile</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-white mb-4 uppercase tracking-wider text-sm">Legal & Support</h4>
            <ul className="space-y-2">
              <li><Link href="/terms" className="text-sm text-muted-foreground hover:text-primary transition-colors">Terms of Service</Link></li>
              <li><Link href="/privacy" className="text-sm text-muted-foreground hover:text-primary transition-colors">Privacy Policy</Link></li>
              <li><Link href="/content-rules" className="text-sm text-muted-foreground hover:text-primary transition-colors">Content Guidelines</Link></li>
              <li><Link href="/refund-policy" className="text-sm text-muted-foreground hover:text-primary transition-colors">Refund Policy</Link></li>
              <li><Link href="/contact" className="text-sm text-muted-foreground hover:text-primary transition-colors">Contact Us</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground/50">
            &copy; {new Date().getFullYear()} HookahBuddys.com. All rights reserved. 21+ only.
          </p>
          <div className="flex gap-4">
            <span className="text-xs text-muted-foreground/50 font-medium px-2 py-1 bg-white/5 rounded">100% Secure Checkout</span>
            <span className="text-xs text-muted-foreground/50 font-medium px-2 py-1 bg-white/5 rounded">Verified Creators</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
