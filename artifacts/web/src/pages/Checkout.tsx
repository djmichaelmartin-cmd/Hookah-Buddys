import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";

export default function Checkout() {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 flex justify-center">
        <div className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-[0_0_40px_rgba(212,175,55,0.1)] w-full max-w-md text-center">
          <h1 className="text-3xl font-serif text-white mb-2">Secure Checkout</h1>
          <p className="text-muted-foreground mb-8">Stripe integration placeholder — no real charge will be made.</p>
          
          <div className="bg-background/50 border border-white/5 rounded-lg p-6 mb-8 text-left">
            <h3 className="text-lg font-medium text-white mb-4 border-b border-white/10 pb-2">Order Summary</h3>
            <div className="flex justify-between mb-2">
              <span className="text-muted-foreground">Item</span>
              <span className="text-white font-medium">Checkout Demo</span>
            </div>
            <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
              <span className="text-white font-bold">Total</span>
              <span className="text-primary font-bold">$0.00</span>
            </div>
          </div>
          
          <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold h-12">
            Confirm Placeholder Payment
          </Button>
        </div>
      </div>
    </Layout>
  );
}
