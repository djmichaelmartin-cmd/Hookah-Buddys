import { useState } from "react";
import {
  useListCreditPackages,
  usePurchaseCredits,
  useGetCurrentUser,
  getGetCreditsQueryKey,
  type CreditPackage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CREDIT_COSTS } from "@workspace/pricing";
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const redirectToLogin = () => {
    toast({
      title: "Sign in to buy credits",
      description: "Please sign in to your member account to purchase credits.",
    });
    navigate("/login");
  };

  const purchase = usePurchaseCredits({
    mutation: {
      onSuccess: (_data, variables) => {
        const pkg = (packages ?? []).find((p) => p.id === variables.data.packageId);
        toast({
          title: "Credits added",
          description: pkg
            ? `${pkg.credits} credits have been added to your balance.`
            : "Your credits have been added.",
        });
        queryClient.invalidateQueries({ queryKey: getGetCreditsQueryKey() });
        if (pkg) onPurchased?.(pkg.credits);
      },
      onError: (error) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) {
          redirectToLogin();
          return;
        }
        toast({
          title: "Purchase failed",
          description: "We couldn't complete your purchase. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  const handleBuy = (packageId: number) => {
    if (!session?.user) {
      redirectToLogin();
      return;
    }
    purchase.mutate({ data: { packageId } });
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
        const pending = purchase.isPending && purchase.variables?.data.packageId === pkg.id;
        const perCredit = pkg.priceCents / pkg.credits;
        return (
          <div
            key={pkg.id}
            className={`relative flex flex-col rounded-2xl border p-6 bg-card/50 backdrop-blur-xl ${
              pkg.label
                ? "border-primary shadow-[0_0_30px_rgba(212,175,55,0.18)]"
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
              {(perCredit).toFixed(2)}¢ per credit
            </p>
            <Button
              className="mt-auto w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={pending}
              onClick={() => handleBuy(pkg.id)}
            >
              {pending ? "Processing..." : "Buy Credits"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

const CREDIT_USES = [
  `Start a conversation — ${CREDIT_COSTS.messageStart} credits`,
  `Send a follow-up message — ${CREDIT_COSTS.messageFollowup} credits`,
  `Attach a photo to a message — ${CREDIT_COSTS.messagePhoto} credits`,
  `Send a priority message — ${CREDIT_COSTS.messagePriority} credits`,
  `Unlock a premium photo — ${CREDIT_COSTS.unlockPhoto} credits`,
  `Unlock a content bundle — ${CREDIT_COSTS.unlockBundle} credits`,
  `Unlock a premium video — ${CREDIT_COSTS.unlockVideo} credits`,
  `Unlock exclusive content — ${CREDIT_COSTS.unlockExclusive} credits`,
  `Video chat — ${CREDIT_COSTS.videoPerMinute} credits/min (${CREDIT_COSTS.videoMinMinutes} min minimum)`,
];

export function CreditUsesList() {
  return (
    <ul className="space-y-2">
      {CREDIT_USES.map((use) => (
        <li key={use} className="flex items-start gap-2 text-sm text-zinc-300">
          <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" /> {use}
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
