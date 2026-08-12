import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useListPlans, getListPlansQueryKey, useCreateCheckout } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Coins } from "lucide-react";

export default function Checkout() {
  const searchParams = new URLSearchParams(window.location.search);
  const type = searchParams.get("type");
  const planSlug = searchParams.get("plan");

  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: plans, isLoading: plansLoading } = useListPlans({ audience: "member" }, { query: { enabled: type === "membership", queryKey: getListPlansQueryKey({ audience: "member" }) } });
  const selectedPlan = plans?.find(p => p.slug === planSlug);

  const createCheckout = useCreateCheckout();

  const handleConfirm = () => {
    if (type === "membership" && selectedPlan) {
      createCheckout.mutate({
        data: { purpose: "membership", amount: selectedPlan.price, referenceId: selectedPlan.id }
      }, {
        onSuccess: (data) => {
          if (data.url) {
            // Redirect to Stripe-hosted checkout page.
            window.location.href = data.url;
          } else {
            toast({
              title: "Payment not configured",
              description: "The payment system is not yet set up on this server. Please contact support.",
              variant: "destructive",
            });
          }
        },
        onError: () => {
          toast({ title: "Payment Error", description: "There was an issue starting checkout. Please try again.", variant: "destructive" });
        }
      });
    } else {
      toast({ title: "Invalid checkout", description: "Unrecognised checkout type.", variant: "destructive" });
    }
  };

  const isProcessing = createCheckout.isPending;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 flex justify-center">
        <div className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-[0_0_40px_rgba(212,175,55,0.1)] w-full max-w-md text-center">
          <h1 className="text-3xl font-serif text-white mb-2">Secure Checkout</h1>
          <p className="text-muted-foreground mb-8">You'll be redirected to Stripe's secure payment page to complete your purchase.</p>
          
          <div className="bg-background/50 border border-white/5 rounded-lg p-6 mb-8 text-left">
            <h3 className="text-lg font-medium text-white mb-4 border-b border-white/10 pb-2">Order Summary</h3>
            
            {type === "membership" ? (
              <>
                {plansLoading ? (
                  <p className="text-muted-foreground">Loading plan details...</p>
                ) : selectedPlan ? (
                  <>
                    <div className="flex justify-between mb-2">
                      <span className="text-muted-foreground">{selectedPlan.name} Membership</span>
                      <span className="text-white font-medium">${selectedPlan.price}/mo</span>
                    </div>
                    
                    {selectedPlan.monthlyCredits > 0 && (
                      <div className="flex items-center gap-2 mt-4 text-sm text-primary">
                        <Coins className="w-4 h-4" /> Includes {selectedPlan.monthlyCredits} credits/month
                      </div>
                    )}
                    
                    <div className="flex justify-between border-t border-white/10 pt-2 mt-4">
                      <span className="text-white font-bold">Total Due Today</span>
                      <span className="text-primary font-bold">${selectedPlan.price}</span>
                    </div>
                    
                    <p className="text-xs text-muted-foreground mt-4 text-center">
                      Recurring billing of ${selectedPlan.price} per month. Cancel anytime via Stripe.
                    </p>
                  </>
                ) : (
                  <p className="text-destructive text-sm">Plan not found.</p>
                )}
              </>
            ) : (
              <p className="text-destructive text-sm">Unrecognised checkout type.</p>
            )}
          </div>
          
          <Button 
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold h-12"
            onClick={handleConfirm}
            disabled={isProcessing || (type === "membership" && !selectedPlan)}
          >
            {isProcessing ? "Redirecting to Stripe..." : "Proceed to Secure Payment"}
          </Button>

          <p className="text-xs text-muted-foreground mt-4">
            Powered by Stripe — your payment details are never stored on our servers.
          </p>
        </div>
      </div>
    </Layout>
  );
}
