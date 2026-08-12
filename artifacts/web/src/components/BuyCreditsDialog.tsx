import { useState } from "react";
import {
  useListCreditPackages,
  useCreateCheckout,
  useGetCurrentUser,
  type CreditPackage,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { CREDIT_COST_ITEMS } from "@workspace/pricing";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Coins, Check } from "lucide-react";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function CreditPackageGrid({
  onPurchased,
  className,
}: {
  onPurchased?: (creditsAdded: number) => void;
  className?: string;
}) {
  const { data: packages, isLoading } = useListCreditPackages();
  const { data: session } = useGetCurrentUser();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [pendingPackageId, setPendingPackageId] = useState<number | null>(null);

  const redirectToLogin = () => {
    toast({
      title: "Sign in to buy credits",
      description: "Please sign in to your member account to purchase credits.",
    });
    navigate("/login");
  };

  const createCheckout = useCreateCheckout();

  const handleBuy = (pkg: CreditPackage) => {
    if (!session?.user) {
      redirectToLogin();
      return;
    }
    setPendingPackageId(pkg.id);
    createCheckout.mutate(
      { data: { purpose: "credits", amount: pkg.priceCents / 100, referenceId: pkg.id } },
      {
        onSuccess: (data) => {
          if (data.url) {
            // Redirect to Stripe-hosted checkout page.
            window.location.href = data.url;
          } else {
            toast({
              title: "Payment not configured",
              description:
                "The payment system is not yet set up on this server. Please contact support.",
              variant: "destructive",
            });
            setPendingPackageId(null);
          }
        },
        onError: (error) => {
          const status = (error as { response?: { status?: number } })?.response?.status;
          if (status === 401 || status === 403) {
            redirectToLogin();
          } else {
            toast({
              title: "Purchase failed",
              description: "We couldn't start checkout. Please try again.",
              variant: "destructive",
            });
          }
          setPendingPackageId(null);
        },
      },
    );
  };

  const sorted = [...(packages ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  if (isLoading) {
    return <p className="text-center text-muted-foreground">Loading credit packages...</p>;
  }

  if (sorted.length === 0) {
    return <p className="text-center text-muted-foreground">No credit packages available right now.</p>;
  }

  return (
    <div className={className ?? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4"}>
      {sorted.map((pkg: CreditPackage) => {
        const pending = pendingPackageId === pkg.id;
        const perCredit = pkg.priceCents / pkg.credits;
        return (
          <div
            key={pkg.id}
            className={`relative flex flex-col rounded-2xl border p-6 bg-card/50 backdrop-blur-xl ${
              pkg.label
                ? "border-primary shadow-[0_0_30px_rgba(0,90,156,0.18)]"
                : "border-white/10"
            }`}
          >
            {pkg.label && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                {pkg.label}
              </span>
            )}
            <h3 className="text-lg font-serif font-bold text-white mb-1">{pkg.name}</h3>
            <div className="flex items-baseline gap-1 mb-2">
              <Coins className="w-5 h-5 text-primary" />
              <span className="text-2xl font-bold text-primary">{pkg.credits.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground">credits</span>
            </div>
            <p className="text-2xl font-bold text-white mb-1">{formatPrice(pkg.priceCents)}</p>
            <p className="text-xs text-muted-foreground mb-6">
              {perCredit.toFixed(2)}¢ per credit
            </p>
            <Button
              className="mt-auto w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={pending || createCheckout.isPending}
              onClick={() => handleBuy(pkg)}
            >
              {pending ? "Redirecting…" : "Buy Credits"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export function CreditUsesList() {
  return (
    <ul className="space-y-2">
      {CREDIT_COST_ITEMS.map((item) => (
        <li key={item.key} className="flex items-start gap-2 text-sm text-zinc-300">
          <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />{" "}
          {item.label} — {item.credits} {item.unit ?? "credits"}
        </li>
      ))}
    </ul>
  );
}

export function BuyCreditsDialog({
  open,
  onOpenChange,
  title = "Buy Credits",
  description = "Add credits to keep messaging, unlocking content, and starting video chats.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-white/10 sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-white flex items-center gap-2">
            <Coins className="w-5 h-5 text-primary" /> {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <CreditPackageGrid
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2"
          onPurchased={() => onOpenChange(false)}
        />
        <div className="mt-4 rounded-xl border border-white/10 bg-background/40 p-4">
          <h4 className="text-sm font-semibold text-white mb-3">How credits work</h4>
          <CreditUsesList />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Hook helper: returns true when an error is an out-of-credits (402) response. */
export function useBuyCreditsState() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
